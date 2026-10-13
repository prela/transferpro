import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedTenant } from './fixtures/seed'
import { chooseOption, signIn, switchLocale, useTheme } from './fixtures/ui'

const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function recordRide(page: Page, guest: string, wall: string): Promise<string> {
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: `Klijent ${guest}`, kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: `Polazak ${guest}`, kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: `Dolazak ${guest}`, kind: 'hotel' },
  }))
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const pickupAt = instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString()
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt,
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
  return body.ride.id
}

test('a true overlap asks before it saves, and a tight gap warns without asking', async ({ page }) => {
  const tenant = await seedTenant('occupy-hr')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Ana Zauzeto',
      kind: 'own',
      phone: '+385911110184',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const firstVehicle = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU184AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU184BB',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU184CC',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))

  const occupied = await recordRide(page, 'Iva Zauzeto', '12:00')
  const assigned = await page.request.post(`/api/rides/${occupied}/assign`, {
    data: { driverId, vehicleId: firstVehicle },
  })
  expect(assigned.ok()).toBeTruthy()

  await recordRide(page, 'Nika Preklop', '12:30')
  await page.getByRole('link', { name: 'Transferi' }).click()
  await page.getByRole('row', { name: 'Nika Preklop' }).getByRole('button', { name: 'Dodijeli: Nika Preklop' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), 'Ana Zauzeto')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), 'DU184BB')
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()

  const dialog = page.getByRole('dialog', { name: 'Ovaj vozač ili vozilo već ima drugu vožnju' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Vremena se preklapaju')
  // The modal hides the day list from the accessibility tree, so read the row from the DOM.
  await expect.poll(() => page.locator('tr').filter({ hasText: 'Nika Preklop' }).textContent()).toContain('Nedodijeljeno')
  await dialog.getByRole('button', { name: 'Nastavi svejedno', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: 'Dodijeljeno' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Nika Preklop' }).getByRole('button', { name: 'Dodijeli: Nika Preklop' })).toHaveCount(0)

  await recordRide(page, 'Tea Usko', '13:40')
  // The day list does not refetch when the nav link is already the current page.
  await page.reload()
  await page.getByRole('row', { name: 'Tea Usko' }).getByRole('button', { name: 'Dodijeli: Tea Usko' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), 'Ana Zauzeto')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), 'DU184CC')
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: 'Razmak prije ili poslije druge vožnje je uzak.' })).toBeVisible()
  // The status cell also names the overlap warning, so the accessible name is longer than the state.
  await expect(page.getByRole('row', { name: 'Tea Usko' }).getByRole('cell', { name: 'Dodijeljeno' })).toContainText('Preklapanje s drugom vožnjom')
})

test('the overlap question is in English in the dark theme', async ({ page }) => {
  const tenant = await seedTenant('occupy-en')
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await switchLocale(page, 'en')
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Ann Clash',
      kind: 'own',
      phone: '+385911110185',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU185AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU185BB',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const occupied = await recordRide(page, 'Iva Clash', '12:00')
  expect((await page.request.post(`/api/rides/${occupied}/assign`, {
    data: { driverId, vehicleId },
  })).ok()).toBeTruthy()
  await recordRide(page, 'Nika Clash', '12:30')
  await page.goto('/transfers')
  await page.getByRole('row', { name: 'Nika Clash' }).getByRole('button', { name: 'Assign: Nika Clash' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Driver' }), 'Ann Clash')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vehicle' }), 'DU185BB')
  await page.getByRole('button', { name: 'Assign ride', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'This driver or vehicle is already on another ride' })
  await expect(dialog).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('row', { name: 'Nika Clash' }).getByRole('button', { name: 'Assign: Nika Clash' })).toBeVisible()
})
