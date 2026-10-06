import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { seedMember, seedTenant, seedVehicleRecord } from './fixtures/seed'
import { chooseOption, signIn, signOut, useTheme } from './fixtures/ui'

const phone = '+385911112233'
const licence = '2027-06-01'

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function addDriver(page: Page, name: string): Promise<string> {
  return createdId(await page.request.post('/api/drivers', {
    data: {
      name,
      kind: 'own',
      phone,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
}

async function addVehicle(page: Page, registrationPlate: string): Promise<string> {
  return createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate,
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
}

/**
 * Records an unassigned Ride for today in the Tenant zone.
 * Returns that pickup day, which is the day the list opens on and the roster key.
 */
async function recordTodayRide(page: Page, guest: string): Promise<{ day: string }> {
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: `Klijent ${guest}`, kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: `Polazak ${guest}`, kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: `Dolazak ${guest}`, kind: 'hotel' },
  }))
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const pickupAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
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
  return { day }
}

async function openAssign(page: Page, guest: string) {
  await page.getByRole('link', { name: 'Transferi' }).click()
  await page.getByRole('row', { name: guest }).getByRole('button', { name: 'Dodijeli', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Dodjela vožnje' })).toBeVisible()
}

test('an admin assigns a ride and the audit log names the actor', async ({ page }) => {
  const tenant = await seedTenant('assign-happy')
  const guest = 'Iva Happy'
  const driverName = 'Ana Happy'
  const plate = 'DU100AA'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  await expect(page.getByRole('cell', { name: 'Nedodijeljeno', exact: true })).toBeVisible()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()

  await expect(page.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: driverName, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: plate, exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: guest }).getByRole('button', { name: 'Dodijeli', exact: true })).toHaveCount(0)

  await page.getByRole('link', { name: 'Početna' }).click()
  await expect(page.getByRole('row', { name: 'Vožnja dodijeljena' })).toContainText(tenant.adminName)
  await expect(page.getByText(guest)).toHaveCount(0)
  await expect(page.getByText(driverName)).toHaveCount(0)
  await expect(page.getByText(plate)).toHaveCount(0)
})

test('the roster pre-fill picks the rostered vehicle, and an override is saved', async ({ page }) => {
  const tenant = await seedTenant('assign-prefill')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva Prefill'
  const driverName = 'Ana Prefill'
  const rosterPlate = 'DU200AA'
  const otherPlate = 'DU200BB'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  const driverId = await addDriver(page, driverName)
  const rosterVehicleId = await addVehicle(page, rosterPlate)
  await addVehicle(page, otherPlate)
  const { day } = await recordTodayRide(page, guest)
  const roster = await page.request.put('/api/roster', {
    data: { rosterDate: day, driverId, vehicleId: rosterVehicleId },
  })
  expect(roster.ok()).toBeTruthy()

  await openAssign(page, guest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await expect(page.getByRole('combobox', { name: 'Vozilo' })).toContainText(rosterPlate)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), otherPlate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()

  await expect(page.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: driverName, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: otherPlate, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: rosterPlate, exact: true })).toHaveCount(0)
})

test('submit stays disabled with only a driver or only a vehicle', async ({ page }) => {
  const tenant = await seedTenant('assign-disabled')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva Disabled'
  const driverName = 'Ana Disabled'
  const plate = 'DU300AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  const submit = page.getByRole('button', { name: 'Dodijeli vožnju', exact: true })
  const vehicle = page.getByRole('combobox', { name: 'Vozilo' })
  await expect(submit).toBeDisabled()

  await chooseOption(page, vehicle, plate)
  await expect(submit).toBeDisabled()

  const prefill = page.waitForResponse(response => response.url().includes('/roster-vehicle'))
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await prefill
  await expect(vehicle).not.toContainText(plate)
  await expect(submit).toBeDisabled()
})

test('a second assign of the same ride shows the not-unassigned message', async ({ page }) => {
  const tenant = await seedTenant('assign-again')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva Again'
  const driverName = 'Ana Again'
  const plate = 'DU400AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  const submit = page.getByRole('button', { name: 'Dodijeli vožnju', exact: true })
  await submit.click()
  await expect(page.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()

  await submit.click()
  await expect(page.getByRole('alert')).toContainText('Dodijeliti se može samo vožnja koja još nema vozača i vozilo.')
  await expect(page.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
})

test('an archived vehicle is not offered', async ({ page }) => {
  const tenant = await seedTenant('assign-archived')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva Archived'
  const livePlate = 'DU500AA'
  const archivedPlate = 'ARH500X'
  await seedVehicleRecord(tenant.tenantId, {
    registrationPlate: archivedPlate,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
    archived: true,
  })
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addVehicle(page, livePlate)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  await page.getByRole('combobox', { name: 'Vozilo' }).click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  await expect(listbox.getByRole('option', { name: archivedPlate, exact: true })).toHaveCount(0)
  await expect(listbox.getByRole('option', { name: livePlate, exact: true })).toBeVisible()
})

test('a driver sees no assign action', async ({ page }) => {
  const tenant = await seedTenant('assign-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  const guest = 'Iva Hidden'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await recordTodayRide(page, guest)
  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  await page.goto('/transfers')
  await expect(page.getByRole('alert')).toContainText('Vozač ne može zabilježiti transfer ni vidjeti dnevni popis.')
  await expect(page.getByRole('button', { name: 'Dodijeli', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
})

test('the assign form uses English copy', async ({ page }) => {
  const tenant = await seedTenant('assign-en')
  const guest = 'Iva English'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await recordTodayRide(page, guest)

  await page.getByRole('link', { name: 'Transferi' }).click()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('columnheader', { name: 'Driver' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Vehicle' })).toBeVisible()
  await page.getByRole('row', { name: guest }).getByRole('button', { name: 'Assign', exact: true }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Assign the ride' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Driver' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Vehicle' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign ride', exact: true })).toBeDisabled()
  await expect(page.getByRole('cell', { name: 'Unassigned', exact: true })).toBeVisible()
})

test('the assign form follows the dark theme', async ({ page }) => {
  const tenant = await seedTenant('assign-dark')
  const guest = 'Iva Dark'
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('combobox', { name: 'Vozač' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Vozilo' })).toBeVisible()
})
