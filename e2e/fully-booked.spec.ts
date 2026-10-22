import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, openListbox, signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

/**
 * Popunjeno on the Transfer slideover, the board warning, and the refusal
 * dialog with no confirmation (ADR-0034, issue #414). The phone project
 * does not run this file.
 */
const zone = 'Europe/Zagreb'
const validOn = '2031-01-01'
const driverName = 'Ana Zauzeta'
const plate = 'DU414AA'
const partnerName = 'Mora Transfer'
const heldGuest = 'Iva Zauzeta'
const bookedGuest = 'Nika Popunjena'
const correctedGuest = 'Mia Popunjena'
const laterGuest = 'Tea Slobodna'

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function chooseMenu(page: Page, dialog: Locator, field: string, option: string) {
  const listbox = await openListbox(page, dialog.getByRole('button', { name: field, exact: true }))
  await listbox.getByRole('option', { name: option, exact: true }).click()
}

test('the slideover warns Popunjeno and still saves, the board shows it, and the refusal offers no confirmation', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  const tenant = await seedTenant('fully-booked-hr')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const partnerId = await createdId(page, '/api/partners', { name: partnerName })
  const driverId = await createdId(page, '/api/drivers', {
    name: driverName,
    kind: 'own',
    phone: '+38595555414',
    drivingLicenceExpiresOn: validOn,
    transportLicenceExpiresOn: validOn,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: plate,
    kind: 'fixed',
    registrationExpiresOn: validOn,
    technicalInspectionExpiresOn: validOn,
    insuranceExpiresOn: validOn,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Agencija Zora', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Zora', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Zora', kind: 'hotel' })
  const day = operationalDay(page)

  async function record(guestName: string, wall: string): Promise<string> {
    const recorded = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T${wall}`, zone).toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName,
        price: 42.5,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    return (await recorded.json() as { ride: { id: string } }).ride.id
  }

  const held = await record(heldGuest, '12:00')
  const assigned = await page.request.post(`/api/rides/${held}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  if (!assigned.ok())
    throw new Error(`${assigned.status()} ${await assigned.text()}`)
  // 11:00–14:00 only. At 18:00 the same Driver and Vehicle are free, so that Ride is not Popunjeno.
  const away = {
    startsAt: instantFromWallClock(`${day}T11:00`, zone).toISOString(),
    endsAt: instantFromWallClock(`${day}T14:00`, zone).toISOString(),
  }
  for (const data of [{ driverId, ...away }, { vehicleId, ...away }, { partnerId, ...away }]) {
    const windowSaved = await page.request.post('/api/unavailability', { data })
    if (!windowSaved.ok())
      throw new Error(`${windowSaved.status()} ${await windowSaved.text()}`)
  }
  await record(laterGuest, '18:00')

  await page.goto('/transfers')
  await hydrated(page)
  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  const slideover = page.getByRole('dialog')
  await expect(slideover).toBeVisible()
  await chooseMenu(page, slideover, 'Naručitelj', 'Agencija Zora')
  await chooseMenu(page, slideover, 'Polazište', 'Polazak Zora')
  await chooseMenu(page, slideover, 'Odredište', 'Dolazak Zora')
  await slideover.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await slideover.getByLabel('Ime gosta').fill(bookedGuest)
  await slideover.getByLabel('Cijena (EUR)').fill('18')
  await chooseOption(page, slideover.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await slideover.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()

  const notices = page.getByRole('region', { name: 'Notifications (F8)' })
  await expect(notices.getByText('Popunjeno')).toBeVisible()
  await expect(notices.getByText('Zabilježeno.')).toBeVisible()
  await expect(page).toHaveURL(/[?&]ride=/)
  const bookedRow = page.getByRole('row').filter({ hasText: bookedGuest })
  await expect(bookedRow).toContainText('Popunjeno')
  await expect(page.getByRole('row').filter({ hasText: laterGuest })).not.toContainText('Popunjeno')

  await page.getByRole('button', { name: /^Upozorenja \(\d+\)$/ }).click()
  await expect(bookedRow).toContainText('Popunjeno')
  await expect(page.getByRole('row').filter({ hasText: laterGuest })).toHaveCount(0)
  await page.getByRole('button', { name: /^Sve \(\d+\)$/ }).click()

  const detail = page.locator('#ride-detail')
  await expect(detail.getByRole('heading', { name: bookedGuest })).toBeVisible()
  await expect(detail).toContainText('Nema slobodnog vozača sa slobodnim vozilom ni slobodnog podizvođača.')
  await detail.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  const correcting = page.getByRole('dialog', { name: 'Ispravi ovaj transfer' })
  await correcting.getByLabel('Ime gosta').fill(correctedGuest)
  await correcting.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  // Create already left a Popunjeno toast. The correction adds the newest one.
  const bookedTitles = notices.getByText('Popunjeno', { exact: true })
  await expect(bookedTitles).toHaveCount(2)
  await expect(bookedTitles.last()).toBeVisible()
  const correctedRow = page.getByRole('row').filter({ hasText: correctedGuest })
  await expect(correctedRow).toContainText('Popunjeno')
  await expect(page.getByRole('row').filter({ hasText: bookedGuest })).toHaveCount(0)

  await correctedRow.getByRole('button', { name: `Dodijeli: ${correctedGuest}` }).click()
  await expect(detail.getByRole('heading', { level: 2, name: 'Dodjela vožnje' })).toBeVisible()
  await chooseOption(page, detail.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, detail.getByRole('combobox', { name: 'Vozilo' }), plate)
  await detail.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  const refused = page.getByRole('dialog', { name: 'Popunjeno' })
  await expect(refused).toContainText('Ovo se ne može potvrditi')
  await expect(refused.getByRole('button', { name: 'Nastavi svejedno', exact: true })).toHaveCount(0)
  await expectNoAxeViolations(page)
  await refused.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(refused).toHaveCount(0)
  await expect(correctedRow).toContainText('Popunjeno')
  await detail.getByRole('button', { name: 'Odustani', exact: true }).click()

  await detail.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true }).click()
  await expect(detail.getByRole('heading', { name: 'Predaj podizvođaču' })).toBeVisible()
  await chooseOption(page, detail.getByRole('combobox', { name: 'Podizvođač' }), partnerName)
  await detail.getByRole('button', { name: 'Predaj vožnju', exact: true }).click()
  const handoffRefused = page.getByRole('dialog', { name: 'Popunjeno' })
  await expect(handoffRefused.getByRole('button', { name: 'Nastavi svejedno', exact: true })).toHaveCount(0)
  await handoffRefused.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(correctedRow).toContainText('Popunjeno')
  await expect(page.getByRole('status').filter({ hasText: 'Predano podizvođaču' })).toHaveCount(0)

  await switchTheme(page, 'dark')
  await switchLocale(page, 'en')
  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await expect(page.locator('html')).toHaveClass(/dark/)
  const englishRow = page.getByRole('row').filter({ hasText: correctedGuest })
  await expect(englishRow).toContainText('Fully booked')
  await englishRow.getByRole('button', { name: `Assign: ${correctedGuest}` }).click()
  const englishDetail = page.locator('#ride-detail')
  await chooseOption(page, englishDetail.getByRole('combobox', { name: 'Driver' }), driverName)
  await chooseOption(page, englishDetail.getByRole('combobox', { name: 'Vehicle' }), plate)
  await englishDetail.getByRole('button', { name: 'Assign ride', exact: true }).click()
  const englishDialog = page.getByRole('dialog', { name: 'Fully booked' })
  await expect(englishDialog).toContainText('This cannot be confirmed')
  await expect(englishDialog.getByRole('button', { name: 'Continue anyway', exact: true })).toHaveCount(0)
  await expectNoAxeViolations(page)
})
