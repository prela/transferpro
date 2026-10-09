import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { seedMember, seedTenant, seedVehicleRecord } from './fixtures/seed'
import { chooseOption, openAudit, signIn, signOut, useTheme } from './fixtures/ui'

const phone = '+385911112233'
const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

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
async function recordTodayRide(page: Page, guest: string, wall = '12:00'): Promise<{ day: string }> {
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
  return { day }
}

function assignButton(page: Page, guest: string) {
  return page.getByRole('row', { name: guest }).getByRole('button', { name: `Dodijeli: ${guest}` })
}

async function openAssign(page: Page, guest: string) {
  await page.getByRole('link', { name: 'Transferi' }).click()
  await assignButton(page, guest).click()
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

  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: 'Dodijeljeno' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: driverName, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: plate, exact: true })).toBeVisible()
  await expect(assignButton(page, guest)).toHaveCount(0)

  await openAudit(page)
  const assigned = page.getByRole('row', { name: 'Vožnja dodijeljena' })
  await expect(assigned).toContainText(tenant.adminName)
  await expect(assigned).toContainText(driverName)
  await expect(assigned).toContainText(plate)
  await expect(page.getByText(guest)).toHaveCount(0)
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
  await expect(page.getByText('Iz rasporeda za taj dan')).toBeVisible()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), otherPlate)
  await expect(page.getByText('Iz rasporeda za taj dan')).toHaveCount(0)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  await expect(page.getByRole('listitem').filter({ hasText: 'Dodijeljeno' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: driverName, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: otherPlate, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: rosterPlate, exact: true })).toHaveCount(0)
})

test('switching from a rostered driver to one without a roster clears the vehicle and the hint', async ({ page }) => {
  const tenant = await seedTenant('assign-stale-roster')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva StaleRoster'
  const rosterDriver = 'Ana Rostered'
  const freeDriver = 'Marko NoRoster'
  const rosterPlate = 'DU330AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  const rosterDriverId = await addDriver(page, rosterDriver)
  await addDriver(page, freeDriver)
  const rosterVehicleId = await addVehicle(page, rosterPlate)
  const { day } = await recordTodayRide(page, guest)
  const roster = await page.request.put('/api/roster', {
    data: { rosterDate: day, driverId: rosterDriverId, vehicleId: rosterVehicleId },
  })
  expect(roster.ok()).toBeTruthy()

  await openAssign(page, guest)
  const vehicle = page.getByRole('combobox', { name: 'Vozilo' })
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), rosterDriver)
  await expect(vehicle).toContainText(rosterPlate)
  await expect(page.getByText('Iz rasporeda za taj dan')).toBeVisible()

  const prefill = page.waitForResponse(response => response.url().includes('/roster-vehicle'))
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), freeDriver)
  await prefill
  await expect(vehicle).toContainText('Odaberite vozilo')
  await expect(vehicle).not.toContainText(rosterPlate)
  await expect(page.getByText('Iz rasporeda za taj dan')).toHaveCount(0)
})

test('a driver with no roster keeps the chosen vehicle and shows no hint', async ({ page }) => {
  const tenant = await seedTenant('assign-keep')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva Keep'
  const driverName = 'Ana Keep'
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
  await expect(vehicle).toContainText(plate)
  await expect(page.getByText('Iz rasporeda za taj dan')).toHaveCount(0)
  await expect(submit).toBeEnabled()
})

test('submit stays disabled with only a driver', async ({ page }) => {
  const tenant = await seedTenant('assign-driver-only')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva DriverOnly'
  const driverName = 'Ana DriverOnly'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, 'DU320AA')
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  const submit = page.getByRole('button', { name: 'Dodijeli vožnju', exact: true })
  const prefill = page.waitForResponse(response => response.url().includes('/roster-vehicle'))
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await prefill
  await expect(page.getByText('Iz rasporeda za taj dan')).toHaveCount(0)
  await expect(submit).toBeDisabled()
})

test('assigning from the form after the ride is already assigned shows the not-unassigned message', async ({ page }) => {
  const tenant = await seedTenant('assign-again')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva Again'
  const driverName = 'Ana Again'
  const plate = 'DU400AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  const driverId = await addDriver(page, driverName)
  const vehicleId = await addVehicle(page, plate)
  const { day } = await recordTodayRide(page, guest)
  const listed = await page.request.get('/api/transfers', { params: { date: day } })
  expect(listed.ok()).toBeTruthy()
  const body = await listed.json() as { rides: { rideId: string, guestName: string }[] }
  const rideId = body.rides.find(ride => ride.guestName === guest)?.rideId
  expect(rideId).toBeTruthy()

  await openAssign(page, guest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Dodijeliti se može samo vožnja koja još nema vozača i vozilo.')
  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toBeVisible()
})

test('a failed roster pre-fill leaves the chosen vehicle and shows no error', async ({ page }) => {
  const tenant = await seedTenant('assign-prefill-fail')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva PrefillFail'
  const driverName = 'Ana PrefillFail'
  const plate = 'DU310AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  await page.route('**/roster-vehicle**', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  const prefill = page.waitForResponse(response => response.url().includes('/roster-vehicle'))
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await prefill
  await expect(page.getByRole('combobox', { name: 'Vozilo' })).toContainText(plate)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Iz rasporeda za taj dan')).toHaveCount(0)
})

test('after assign, focus moves to the next unassigned ride assign button', async ({ page }) => {
  const tenant = await seedTenant('assign-focus-next')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const firstGuest = 'Iva FocusFirst'
  const nextGuest = 'Iva FocusNext'
  const driverName = 'Ana FocusNext'
  const plate = 'DU340AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, firstGuest, '10:00')
  await recordTodayRide(page, nextGuest, '11:00')

  await openAssign(page, firstGuest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  await expect(assignButton(page, nextGuest)).toBeFocused()
})

test('after assigning the last ride in the list, focus wraps to the first unassigned assign button', async ({ page }) => {
  const tenant = await seedTenant('assign-focus-wrap')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const firstGuest = 'Iva WrapFirst'
  const lastGuest = 'Iva WrapLast'
  const driverName = 'Ana FocusWrap'
  const plate = 'DU360AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, firstGuest, '10:00')
  await recordTodayRide(page, lastGuest, '11:00')

  await openAssign(page, lastGuest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  await expect(assignButton(page, firstGuest)).toBeFocused()
})

test('after the last assign, focus moves to the day list region', async ({ page }) => {
  const tenant = await seedTenant('assign-focus-region')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva FocusRegion'
  const driverName = 'Ana FocusRegion'
  const plate = 'DU350AA'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), plate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Transferi' })).toBeFocused()
})

test('cancel closes the form and returns focus to assign', async ({ page }) => {
  const tenant = await seedTenant('assign-cancel')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const guest = 'Iva Cancel'
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await recordTodayRide(page, guest)

  await openAssign(page, guest)
  await expect(page.getByRole('combobox', { name: 'Vozač' })).toBeFocused()
  await page.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  await expect(assignButton(page, guest)).toBeFocused()
})

test('an assigned archived vehicle keeps its plate with a badge, and the picker omits it', async ({ page }) => {
  const tenant = await seedTenant('assign-archived')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const assignedGuest = 'Iva AssignedArchived'
  const openGuest = 'Iva OpenArchived'
  const driverName = 'Ana Archived'
  const livePlate = 'DU500AA'
  const otherPlate = 'DU500BB'
  const archivedPlate = 'ARH500X'
  await seedVehicleRecord(tenant.tenantId, {
    registrationPlate: archivedPlate,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
    archived: true,
  })
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  const liveVehicleId = await addVehicle(page, livePlate)
  await addVehicle(page, otherPlate)
  await recordTodayRide(page, assignedGuest)
  await recordTodayRide(page, openGuest)

  await openAssign(page, assignedGuest)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), driverName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), livePlate)
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: livePlate, exact: true })).toBeVisible()

  const archived = await page.request.post(`/api/vehicles/${liveVehicleId}/archive`)
  expect(archived.ok()).toBeTruthy()
  await page.reload()
  const assignedRow = page.getByRole('row', { name: assignedGuest })
  await expect(assignedRow).toContainText(livePlate)
  await expect(assignedRow).toContainText('Arhivirano')

  await assignButton(page, openGuest).click()
  await page.getByRole('combobox', { name: 'Vozilo' }).click()
  const listbox = page.getByRole('listbox')
  await expect(listbox.getByRole('option', { name: otherPlate, exact: true })).toBeVisible()
  await expect(listbox.getByRole('option', { name: archivedPlate, exact: true })).toHaveCount(0)
  await expect(listbox.getByRole('option', { name: livePlate, exact: true })).toHaveCount(0)
})

test('a driver sees no assign action', async ({ page }) => {
  const tenant = await seedTenant('assign-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  const guest = 'Iva Hidden'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await recordTodayRide(page, guest)
  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  const dayLists: string[] = []
  const onRequest = (request: { method: () => string, url: () => string }) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/transfers')
      dayLists.push(request.url())
  }
  page.on('request', onRequest)
  try {
    await page.goto('/transfers')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
    expect(dayLists).toEqual([])
    await expect(page.getByText('Vozač ne može zabilježiti transfer ni vidjeti dnevni popis.')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Dodijeli/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Dodjela vožnje' })).toHaveCount(0)
  }
  finally {
    page.off('request', onRequest)
  }
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
  await expect(page.getByRole('columnheader', { name: 'Actions' })).toBeAttached()
  const assign = page.getByRole('row', { name: guest }).getByRole('button', { name: `Assign: ${guest}` })
  await expect(assign).toHaveAccessibleName(`Assign: ${guest}`)
  await assign.click()
  await expect(page.getByRole('heading', { level: 2, name: 'Assign the ride' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Driver' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Vehicle' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign ride', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
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
