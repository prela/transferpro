import type { APIResponse, Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant, seedVehicleRecord } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale } from './fixtures/ui'

/**
 * A Vehicle seat count and the passenger warning (ADR-0059).
 * The warning is text. Assign still saves. Phone and desktop, Croatian and English, axe.
 */

const warningHr = 'Vožnja ima više putnika nego što vozilo ima sjedala. Dodajte dodatno vozilo.'
const warningEn = 'This ride has more passengers than the vehicle\'s seats. Add an extra vehicle.'
const rowHr = 'Više putnika nego sjedala'
const rowEn = 'More passengers than seats'
const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

function rideRow(page: Page, guest: string) {
  if (isPhone(page))
    return page.getByRole('listitem').filter({ hasText: guest })
  return page.getByRole('row', { name: guest })
}

async function createdId(response: Promise<APIResponse>): Promise<string> {
  const resolved = await response
  if (!resolved.ok())
    throw new Error(`${resolved.status()} ${await resolved.text()}`)
  const body = await resolved.json() as { id: string }
  return body.id
}

async function addDriver(page: Page, name: string): Promise<string> {
  return createdId(page.request.post('/api/drivers', {
    data: {
      name,
      kind: 'own',
      phone: '+385911115545',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
}

async function addVehicle(page: Page, registrationPlate: string, seatCount: number): Promise<string> {
  return createdId(page.request.post('/api/vehicles', {
    data: {
      registrationPlate,
      kind: 'fixed',
      seatCount,
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
}

async function recordToday(page: Page, guest: string, passengerCount: number, wall: string): Promise<{ day: string, rideId: string }> {
  const clientId = await createdId(page.request.post('/api/clients', {
    data: { name: `Klijent ${guest}`, kind: 'agency' },
  }))
  const startLocationId = await createdId(page.request.post('/api/locations', {
    data: { name: `Polazak ${guest}`, kind: 'airport' },
  }))
  const endLocationId = await createdId(page.request.post('/api/locations', {
    data: { name: `Dolazak ${guest}`, kind: 'hotel' },
  }))
  const day = operationalDay(page)
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount,
      guestName: guest,
      price: 40,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const body = await recorded.json() as { ride: { id: string } }
  return { day, rideId: body.ride.id }
}

async function chooseCrew(page: Page, driverName: string, plate: string) {
  const detail = page.locator('#ride-detail')
  if (isPhone(page))
    await detail.getByRole('button', { name: driverName }).click()
  else
    await chooseOption(page, detail.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, detail.getByRole('combobox', { name: 'Vozilo' }), plate)
}

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

test.describe('@phone', () => {
  test('a seat count is required, and too many passengers warn without blocking assign', async ({ page }) => {
    test.setTimeout(90_000)
    if (!isPhone(page))
      await page.setViewportSize({ width: 1440, height: 900 })

    const tenant = await seedTenant('seat-count')
    const driverName = 'Ana Sjedala'
    const smallPlate = 'SEAT03AA'
    const openPlate = 'SEAT00BB'
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

    await page.getByRole('link', { name: 'Vozila' }).click()
    await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Registarska oznaka', { exact: true }).fill('FORM08CC')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Stalno')
    await dialog.getByLabel('Registracija vrijedi do').fill('2027-06-01')
    await dialog.getByLabel('Tehnički pregled vrijedi do').fill('2028-01-31')
    await dialog.getByLabel('Osiguranje vrijedi do').fill('2029-03-03')
    await dialog.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Unesite broj sjedala.')
    await dialog.getByLabel('Broj sjedala').fill('0')
    await dialog.getByRole('button', { name: 'Dodaj vozilo', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Broj sjedala je najmanje 1.')
    await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()

    await addDriver(page, driverName)
    await addVehicle(page, smallPlate, 3)
    await seedVehicleRecord(tenant.tenantId, {
      registrationPlate: openPlate,
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    })
    const fits = await recordToday(page, 'Iva Stane', 2, '08:00')
    const overflows = await recordToday(page, 'Iva NeStane', 5, '12:00')
    const legacy = await recordToday(page, 'Iva Prazno', 6, '16:00')

    await page.goto(`/transfers?day=${fits.day}&ride=${fits.rideId}`)
    await hydrated(page)
    const detail = page.locator('#ride-detail')
    await detail.getByRole('button', { name: 'Dodijeli', exact: true }).click()
    await chooseCrew(page, driverName, smallPlate)
    await expect(detail.getByText(warningHr)).toHaveCount(0)
    await detail.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
    await expect(detail.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
    await page.goto(`/transfers?day=${fits.day}&ride=${fits.rideId}`)
    await hydrated(page)
    await expect(rideRow(page, 'Iva Stane')).not.toContainText(rowHr)
    await expect(detail.getByText(warningHr)).toHaveCount(0)

    await detail.getByRole('button', { name: 'Više', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
    await detail.getByLabel('Putnici').fill('5')
    await detail.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
    await page.goto(`/transfers?day=${fits.day}&ride=${fits.rideId}`)
    await hydrated(page)
    await expect(detail.getByText(warningHr)).toBeVisible()
    await expect(rideRow(page, 'Iva Stane')).toContainText(rowHr)
    await expectNoAxeViolations(page)

    await page.goto(`/transfers?day=${overflows.day}&ride=${overflows.rideId}`)
    await hydrated(page)
    await detail.getByRole('button', { name: 'Dodijeli', exact: true }).click()
    await chooseCrew(page, driverName, smallPlate)
    await expect(detail.getByRole('status').filter({ hasText: warningHr })).toBeVisible()
    await detail.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
    await expect(detail.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
    await page.goto(`/transfers?day=${overflows.day}&ride=${overflows.rideId}`)
    await hydrated(page)
    await expect(detail.getByText(warningHr)).toBeVisible()

    await page.goto(`/transfers?day=${legacy.day}&ride=${legacy.rideId}`)
    await hydrated(page)
    await detail.getByRole('button', { name: 'Dodijeli', exact: true }).click()
    await chooseCrew(page, driverName, openPlate)
    await expect(detail.getByText(warningHr)).toHaveCount(0)
    await detail.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
    await expect(detail.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
    await page.goto(`/transfers?day=${legacy.day}`)
    await hydrated(page)
    await expect(rideRow(page, 'Iva Prazno')).not.toContainText(rowHr)

    await switchLocale(page, 'en')
    await page.goto(`/transfers?day=${fits.day}&ride=${fits.rideId}`)
    await hydrated(page)
    await expect(detail.getByText(warningEn)).toBeVisible()
    await expect(rideRow(page, 'Iva Stane')).toContainText(rowEn)
    await expectNoAxeViolations(page)
  })
})
