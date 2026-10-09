import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { seedTenant } from './fixtures/seed'
import { signIn, useTheme } from './fixtures/ui'

const phone = '+385911113344'
const plate = 'DU107AA'
const guest = 'Iva Phone'
const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

/**
 * Records an assigned Ride whose copied flag is on, then the office accepts it by phone.
 * The audit log is /audit. The day-list button is covered separately.
 */
async function acceptByPhone(page: Page): Promise<void> {
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Bez računa',
      kind: 'own',
      phone,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const corrected = await page.request.patch(`/api/drivers/${driverId}`, { data: { mustAccept: true } })
  expect(corrected.ok()).toBeTruthy()
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: plate,
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Iva', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Iva', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Dolazak Iva', kind: 'hotel' },
  }))
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
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
  const body = await recorded.json() as { ride: { id: string } }
  const assigned = await page.request.post(`/api/rides/${body.ride.id}/assign`, {
    data: { driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()
  const accepted = await page.request.post(`/api/rides/${body.ride.id}/accept-by-phone`, { data: {} })
  expect(accepted.ok()).toBeTruthy()
}

test('the audit log names the admin and says the acceptance was confirmed by phone', async ({ page }) => {
  const tenant = await seedTenant('phone-accept')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await acceptByPhone(page)
  await page.goto('/audit')

  const row = page.getByRole('row', { name: 'Prihvaćanje potvrđeno telefonom' })
  await expect(row).toContainText(tenant.adminName)
  await expect(row.getByRole('cell', { name: `${tenant.adminName} Prihvaćanje potvrđeno telefonom`, exact: true })).toBeVisible()
  await expect(row).not.toContainText(plate)
  await expect(row).not.toContainText(phone)
  await expect(row).not.toContainText(guest)
  await expect(row).not.toContainText('Marko Bez računa')

  await useTheme(page, 'dark')
  await page.reload()
  await expect(page.getByRole('row', { name: 'Prihvaćanje potvrđeno telefonom' })).toContainText(tenant.adminName)

  await page.getByRole('button', { name: 'English', exact: true }).click()
  const english = page.getByRole('row', { name: 'Acceptance confirmed by phone' })
  await expect(english).toContainText(tenant.adminName)
  await expect(english.getByRole('cell', { name: `${tenant.adminName} Acceptance confirmed by phone`, exact: true })).toBeVisible()
  await expect(english).not.toContainText(plate)
  await expect(english).not.toContainText(phone)
  await expect(english).not.toContainText(guest)
  await expect(english).not.toContainText('Marko Bez računa')
})
