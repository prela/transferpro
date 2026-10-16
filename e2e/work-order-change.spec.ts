import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedTenant } from './fixtures/seed'
import { chooseOption, openRideMenu, signIn, switchLocale } from './fixtures/ui'

const phone = '+385911112255'
const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)
const sentAddress = 'ana-sent@example.test'

async function addDriver(page: Page, name: string, email?: string): Promise<void> {
  const response = await page.request.post('/api/drivers', {
    data: {
      name,
      kind: 'own',
      phone,
      email,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function addVehicle(page: Page, registrationPlate: string): Promise<void> {
  const response = await page.request.post('/api/vehicles', {
    data: {
      registrationPlate,
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  })
  expect(response.ok()).toBeTruthy()
}

async function recordTodayRide(page: Page, guest: string): Promise<void> {
  const client = await page.request.post('/api/clients', {
    data: { name: `Klijent ${guest}`, kind: 'agency' },
  })
  const start = await page.request.post('/api/locations', {
    data: { name: `Polazak ${guest}`, kind: 'airport' },
  })
  const end = await page.request.post('/api/locations', {
    data: { name: `Dolazak ${guest}`, kind: 'hotel' },
  })
  expect(client.ok() && start.ok() && end.ok()).toBeTruthy()
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const pickupAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId: (await client.json() as { id: string }).id,
      pickupAt,
      startLocationId: (await start.json() as { id: string }).id,
      endLocationId: (await end.json() as { id: string }).id,
      passengerCount: 1,
      guestName: guest,
      price: 42.5,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
}

function row(page: Page, guest: string) {
  return page.getByRole('row', { name: guest })
}

// A result toast is dismissed after a few seconds, so an earlier action's toast
// may or may not still be on screen. Match each toast by the title of the action
// that raised it, not by a running count across actions.
function notice(page: Page, title: string, sentence: string) {
  return page.getByRole('status').filter({ hasText: title }).filter({ hasText: sentence })
}

test('a vehicle change, a reassign, and a clear each name the Driver, in Croatian, with an English smoke', async ({ page }) => {
  const tenant = await seedTenant('work-order-change')
  const firstPlate = 'DU167AA'
  const secondPlate = 'DU167BB'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await addDriver(page, 'Ana Sent', sentAddress)
  await addDriver(page, 'Ana Blank')
  await addVehicle(page, firstPlate)
  await addVehicle(page, secondPlate)
  await recordTodayRide(page, 'Iva Change')
  await recordTodayRide(page, 'Iva English')

  await page.getByRole('link', { name: 'Transferi' }).click()
  await row(page, 'Iva Change').getByRole('button', { name: 'Dodijeli: Iva Change' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), 'Ana Sent')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), firstPlate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(row(page, 'Iva Change').getByRole('cell', { name: /^Dodijeljeno/ })).toBeVisible()

  await openRideMenu(page, 'Iva Change')
  await page.getByRole('menuitem', { name: 'Promijeni vozilo', exact: true }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), secondPlate)
  await page.getByRole('button', { name: 'Promijeni vozilo', exact: true }).click()
  const sentToAna = 'Radni nalog je poslan vozaču Ana Sent.'
  const blankAna = 'Vozač Ana Blank nema e-poštu. Radni nalog nije poslan.'
  await expect(notice(page, 'Vozilo promijenjeno', sentToAna)).toHaveCount(1)
  await expect(page.getByText(sentAddress)).toHaveCount(0)
  await expect(row(page, 'Iva Change')).toContainText(secondPlate)

  await openRideMenu(page, 'Iva Change')
  await page.getByRole('menuitem', { name: 'Prebaci', exact: true }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), 'Ana Blank')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), firstPlate)
  await page.getByRole('button', { name: 'Prebaci vožnju', exact: true }).click()
  // A reassign names both Drivers: the new one stays in the detail (no email), the previous one is a toast (sent).
  await expect(page.getByRole('alert').filter({ hasText: 'Prebačeno' }).filter({ hasText: blankAna })).toHaveCount(1)
  await expect(notice(page, 'Prebačeno', sentToAna)).toHaveCount(1)
  await expect(page.getByText(sentAddress)).toHaveCount(0)

  await openRideMenu(page, 'Iva Change')
  await page.getByRole('menuitem', { name: 'Ukloni dodjelu', exact: true }).click()
  await page.getByRole('dialog', { name: 'Uklanjanje dodjele' }).getByRole('button', { name: 'Ukloni dodjelu', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Dodjela uklonjena' }).filter({ hasText: blankAna })).toHaveCount(1)
  await expect(row(page, 'Iva Change').getByRole('cell', { name: /^Nedodijeljeno/ })).toBeVisible()

  await switchLocale(page, 'en')
  await page.getByRole('link', { name: 'Transfers' }).click()
  await row(page, 'Iva English').getByRole('button', { name: 'Assign: Iva English' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Driver' }), 'Ana Sent')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vehicle' }), firstPlate)
  await page.getByRole('button', { name: 'Assign ride', exact: true }).click()
  await openRideMenu(page, 'Iva English')
  await page.getByRole('menuitem', { name: 'Change vehicle', exact: true }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vehicle' }), secondPlate)
  await page.getByRole('button', { name: 'Change vehicle', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Vehicle changed' }).filter({ hasText: 'Work order sent to Ana Sent.' })).toBeVisible()
  await expect(page.getByText(sentAddress)).toHaveCount(0)
})
