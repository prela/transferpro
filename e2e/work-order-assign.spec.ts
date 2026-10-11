import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedTenant } from './fixtures/seed'
import { chooseOption, signIn, switchLocale } from './fixtures/ui'

const phone = '+385911112244'
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

/** Each Ride gets its own hour so one Vehicle carries them all without an overlap (ADR-0029). */
async function recordTodayRide(page: Page, guest: string, time: string): Promise<void> {
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
  const pickupAt = instantFromWallClock(`${day}T${time}`, 'Europe/Zagreb').toISOString()
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

async function assign(page: Page, guest: string, driverName: string, plate: string, button: string) {
  await page.getByRole('link', { name: 'Transferi' }).click()
  await page.getByRole('row', { name: guest }).getByRole('button', { name: `Dodijeli: ${guest}` }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  await page.getByRole('button', { name: button, exact: true }).click()
}

test('assign reports sent and no email, in Croatian, with an English smoke', async ({ page }) => {
  const tenant = await seedTenant('work-order')
  const plate = 'DU166AA'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await addDriver(page, 'Ana Sent', sentAddress)
  await addDriver(page, 'Ana Blank')
  await addVehicle(page, plate)
  await recordTodayRide(page, 'Iva Sent', '08:00')
  await recordTodayRide(page, 'Iva Blank', '10:00')
  await recordTodayRide(page, 'Iva English', '12:00')
  await recordTodayRide(page, 'Iva NoEmail', '14:00')

  await assign(page, 'Iva Sent', 'Ana Sent', plate, 'Dodijeli vožnju')
  await expect(page.getByRole('listitem').filter({ hasText: 'Radni nalog je poslan vozaču Ana Sent.' })).toBeVisible()
  await expect(page.getByText(sentAddress)).toHaveCount(0)

  await assign(page, 'Iva Blank', 'Ana Blank', plate, 'Dodijeli vožnju')
  await expect(page.getByRole('listitem').filter({ hasText: 'Vozač Ana Blank nema e-poštu. Radni nalog nije poslan.' })).toBeVisible()

  await switchLocale(page, 'en')
  await page.getByRole('link', { name: 'Transfers' }).click()
  await page.getByRole('row', { name: 'Iva English' }).getByRole('button', { name: 'Assign: Iva English' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Driver' }), 'Ana Sent')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vehicle' }), plate)
  await page.getByRole('button', { name: 'Assign ride', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Work order sent to Ana Sent.' })).toBeVisible()
  await expect(page.getByText(sentAddress)).toHaveCount(0)

  await page.getByRole('link', { name: 'Transfers' }).click()
  await page.getByRole('row', { name: 'Iva NoEmail' }).getByRole('button', { name: 'Assign: Iva NoEmail' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Driver' }), 'Ana Blank')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vehicle' }), plate)
  await page.getByRole('button', { name: 'Assign ride', exact: true }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Ana Blank has no email. No work order was sent.' })).toBeVisible()
})
