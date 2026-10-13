import type { APIResponse } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, switchTheme } from './fixtures/ui'

const timeZone = 'Europe/Zagreb'
const day = '2026-10-20'
const validOn = '2031-01-01'

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

test('the day board shows an expired document, a roster mismatch, and an overlap in both locales', async ({ page }) => {
  const tenant = await seedTenant('board-warnings')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Agencija Mora', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Zračna luka Dubrovnik', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Excelsior', kind: 'hotel' },
  }))
  const warnedDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Ivo Istek',
      kind: 'own',
      phone: '+38595555212',
      drivingLicenceExpiresOn: '2026-10-19',
      transportLicenceExpiresOn: validOn,
    },
  }))
  const otherDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Branko Raspored',
      kind: 'own',
      phone: '+38595555213',
      drivingLicenceExpiresOn: validOn,
      transportLicenceExpiresOn: validOn,
    },
  }))
  const cleanDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Tea Čista',
      kind: 'own',
      phone: '+38595555214',
      drivingLicenceExpiresOn: validOn,
      transportLicenceExpiresOn: validOn,
    },
  }))
  const warnedVehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU212AA',
      kind: 'fixed',
      registrationExpiresOn: validOn,
      technicalInspectionExpiresOn: validOn,
      insuranceExpiresOn: '2026-10-01',
    },
  }))
  const cleanVehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU213AA',
      kind: 'fixed',
      registrationExpiresOn: validOn,
      technicalInspectionExpiresOn: validOn,
      insuranceExpiresOn: validOn,
    },
  }))

  const roster = await page.request.put('/api/roster', {
    data: { rosterDate: day, driverId: otherDriverId, vehicleId: warnedVehicleId },
  })
  if (!roster.ok())
    throw new Error(`${roster.status()} ${await roster.text()}`)

  async function record(guestName: string, wall: string, driverId: string, vehicleId: string, confirm = false): Promise<void> {
    const response = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T${wall}`, timeZone).toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName,
        price: 10,
        payment: 'cash',
        airportMark: true,
        luggageCount: 0,
        childSeatCount: 0,
        note: null,
        tabla: '',
      },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
    const body = await response.json() as { ride: { id: string } }
    const assigned = await page.request.post(`/api/rides/${body.ride.id}/assign`, {
      data: { driverId, vehicleId, ...(confirm ? { confirm: true } : {}) },
    })
    if (!assigned.ok())
      throw new Error(`${assigned.status()} ${await assigned.text()}`)
  }

  await record('Warned Ivo', '12:00', warnedDriverId, warnedVehicleId)
  await record('Warned Iva', '12:20', warnedDriverId, warnedVehicleId, true)
  await record('Clean Tea', '18:00', cleanDriverId, cleanVehicleId)

  await page.goto('/transfers')
  async function showDay(): Promise<void> {
    const today = operationalDateInTimeZone(timeZone, new Date())
    // The server paints today's operational day before Vue hydrates. Filling
    // earlier sticks in the DOM, then hydration writes that day back.
    await hydrated(page)
    await expect(page.locator('#transfer-day')).toHaveValue(today)
    const listed = page.waitForResponse(response =>
      response.url().includes('/api/transfers')
      && response.url().includes(`date=${day}`)
      && response.ok(),
    )
    await page.locator('#transfer-day').fill(day)
    await listed
    await expect(page.locator('#transfer-day')).toHaveValue(day)
  }
  await showDay()

  const warned = page.getByRole('row').filter({ hasText: 'Warned Ivo' })
  const clean = page.getByRole('row').filter({ hasText: 'Clean Tea' })
  await expect(warned).toContainText('Istekli dokumenti: Vozačka dozvola, Osiguranje')
  await expect(warned).toContainText('Nesklad rasporeda')
  await expect(warned).toContainText('Preklapanje s drugom vožnjom')
  await expect(warned).not.toContainText('Warned Iva')
  await expect(clean).not.toContainText('Istekli dokumenti')
  await expect(clean).not.toContainText('Nesklad rasporeda')
  await expect(clean).not.toContainText('Preklapanje')

  await page.getByRole('button', { name: 'Osvježi popis', exact: true }).click()
  await expect(warned).toContainText('Nesklad rasporeda')

  await switchLocale(page, 'en')
  await showDay()
  const warnedEn = page.getByRole('row').filter({ hasText: 'Warned Ivo' })
  await expect(warnedEn).toContainText('Expired documents: Driving licence, Insurance')
  await expect(warnedEn).toContainText('Roster mismatch')
  await expect(warnedEn).toContainText('Overlaps another ride')
  await expect(warnedEn).not.toContainText('Warned Iva')
  await switchTheme(page, 'dark')
  await showDay()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('row').filter({ hasText: 'Warned Ivo' })).toContainText('Roster mismatch')
  await switchTheme(page, 'light')

  await page.setViewportSize({ width: 390, height: 844 })
  await showDay()
  const narrow = page.getByRole('row').filter({ hasText: 'Warned Ivo' })
  const overlap = narrow.getByText('Overlaps another ride')
  await overlap.scrollIntoViewIfNeeded()
  await expect(overlap).toBeInViewport()
  await expect(narrow).toContainText('Expired documents: Driving licence, Insurance')
  await expect(narrow).toContainText('Roster mismatch')
  await expect(page.getByRole('row').filter({ hasText: 'Clean Tea' })).not.toContainText('Roster mismatch')
})
