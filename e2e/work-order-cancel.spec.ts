import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedTenant } from './fixtures/seed'
import { openRideMenu, signIn, switchLocale } from './fixtures/ui'

const phone = '+385911112269'
const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)
const sentAddress = 'ana-cancel@example.test'

async function addDriver(page: Page, name: string, email?: string): Promise<string> {
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
  return (await response.json() as { id: string }).id
}

async function addVehicle(page: Page, registrationPlate: string): Promise<string> {
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
  return (await response.json() as { id: string }).id
}

async function recordTodayRide(page: Page, guest: string, time: string): Promise<string> {
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
  return (await recorded.json() as { ride: { id: string } }).ride.id
}

async function assign(page: Page, rideId: string, driverId: string, vehicleId: string): Promise<void> {
  const response = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { driverId, vehicleId },
  })
  expect(response.ok()).toBeTruthy()
}

function row(page: Page, guest: string) {
  return page.getByRole('row', { name: guest })
}

function notice(page: Page, title: string, sentence?: string) {
  const item = page.getByRole('listitem').filter({ hasText: title })
  return sentence === undefined ? item : item.filter({ hasText: sentence })
}

test('cancel reports sent and no email, in Croatian, with an English smoke', async ({ page }) => {
  const tenant = await seedTenant('work-order-cancel')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const sentId = await addDriver(page, 'Ana Sent', sentAddress)
  const blankId = await addDriver(page, 'Ana Blank')
  const vehicleId = await addVehicle(page, 'DU169AA')
  await recordTodayRide(page, 'Iva Quiet', '08:00')
  const sentRide = await recordTodayRide(page, 'Iva Sent', '10:00')
  const blankRide = await recordTodayRide(page, 'Iva Blank', '12:00')
  const englishRide = await recordTodayRide(page, 'Iva English', '14:00')
  await assign(page, sentRide, sentId, vehicleId)
  await assign(page, blankRide, blankId, vehicleId)
  await assign(page, englishRide, sentId, vehicleId)

  await page.getByRole('link', { name: 'Transferi' }).click()

  await openRideMenu(page, 'Iva Quiet')
  await page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true }).click()
  await page.getByRole('dialog', { name: 'Otkaži vožnju' }).getByRole('button', { name: 'Otkaži vožnju', exact: true }).click()
  await expect(notice(page, 'Vožnja otkazana')).toHaveCount(1)
  await expect(notice(page, 'Vožnja otkazana')).not.toContainText('Radni nalog')
  await expect(row(page, 'Iva Quiet').getByRole('cell', { name: 'Otkazano', exact: true })).toBeVisible()

  const sentToAna = 'Radni nalog je poslan vozaču Ana Sent.'
  await openRideMenu(page, 'Iva Sent')
  await page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true }).click()
  await page.getByRole('dialog', { name: 'Otkaži vožnju' }).getByRole('button', { name: 'Otkaži vožnju', exact: true }).click()
  await expect(notice(page, 'Vožnja otkazana', sentToAna)).toHaveCount(1)
  await expect(page.getByText(sentAddress)).toHaveCount(0)
  await expect(row(page, 'Iva Sent').getByRole('cell', { name: 'Otkazano', exact: true })).toBeVisible()

  const blankAna = 'Vozač Ana Blank nema e-poštu. Radni nalog nije poslan.'
  await openRideMenu(page, 'Iva Blank')
  await page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true }).click()
  await page.getByRole('dialog', { name: 'Otkaži vožnju' }).getByRole('button', { name: 'Otkaži vožnju', exact: true }).click()
  await expect(notice(page, 'Vožnja otkazana', blankAna)).toHaveCount(1)
  await expect(page.getByText(sentAddress)).toHaveCount(0)

  await switchLocale(page, 'en')
  await page.getByRole('link', { name: 'Transfers' }).click()
  await openRideMenu(page, 'Iva English')
  await page.getByRole('menuitem', { name: 'Cancel ride', exact: true }).click()
  await page.getByRole('dialog', { name: 'Cancel the ride' }).getByRole('button', { name: 'Cancel ride', exact: true }).click()
  await expect(notice(page, 'Ride cancelled', 'Work order sent to Ana Sent.')).toHaveCount(1)
  await expect(page.getByText(sentAddress)).toHaveCount(0)
  await expect(row(page, 'Iva English').getByRole('cell', { name: 'Cancelled', exact: true })).toBeVisible()
})
