import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)
const waitingGuest = 'Nika Phone'
const plainGuest = 'Lara Plain'
const openGuest = 'Ema Open'
const mustDriver = 'Marko Must'
const freeDriver = 'Ana Free'
const mustPlate = 'DU100AA'
const freePlate = 'DU100BB'

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function addDriver(page: Page, name: string, phone: string): Promise<string> {
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
 * Records one Ride on the operational day the board opens on.
 * `wall` is 05:00 or later, so the Ride stays on that day. Noon on the
 * calendar date, when now is before 05:00, is the next operational day.
 * Returns that day and the Ride id.
 */
async function recordTodayRide(page: Page, guest: string, wall: string, places: {
  clientId: string
  startLocationId: string
  endLocationId: string
}): Promise<{ day: string, rideId: string }> {
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId: places.clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
      startLocationId: places.startLocationId,
      endLocationId: places.endLocationId,
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
  return { day, rideId: body.ride.id }
}

async function assignRide(page: Page, rideId: string, driverId: string, vehicleId: string) {
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()
}

async function dayRide(page: Page, day: string, guest: string) {
  const response = await page.request.get('/api/transfers', { params: { date: day } })
  expect(response.ok()).toBeTruthy()
  const body = await response.json() as {
    rides: { guestName: string, state: string, mustAccept: boolean | null }[]
  }
  const ride = body.rides.find(row => row.guestName === guest)
  if (!ride)
    throw new Error(`missing ${guest}`)
  return ride
}

test('the day list records acceptance confirmed by phone, and cancel writes nothing', async ({ page }) => {
  const tenant = await seedTenant('day-accept-phone')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const mail: string[] = []
  let acceptPosts = 0
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
    if (request.method() === 'POST' && request.url().includes('/accept-by-phone'))
      acceptPosts += 1
  })

  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const mustDriverId = await addDriver(page, mustDriver, '+385911110100')
  const mustAccept = await page.request.patch(`/api/drivers/${mustDriverId}`, { data: { mustAccept: true } })
  expect(mustAccept.ok()).toBeTruthy()
  const freeDriverId = await addDriver(page, freeDriver, '+385911110101')
  const mustVehicleId = await addVehicle(page, mustPlate)
  const freeVehicleId = await addVehicle(page, freePlate)
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Nika', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Nika', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Dolazak Nika', kind: 'hotel' },
  }))
  const places = { clientId, startLocationId, endLocationId }
  const waiting = await recordTodayRide(page, waitingGuest, '10:00', places)
  const plain = await recordTodayRide(page, plainGuest, '11:00', places)
  const open = await recordTodayRide(page, openGuest, '12:00', places)
  await assignRide(page, waiting.rideId, mustDriverId, mustVehicleId)
  await assignRide(page, plain.rideId, freeDriverId, freeVehicleId)

  // The day list is the office screen. A dispatcher records the phone confirmation.
  await signOut(page)
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Transferi' }).click()

  const waitingRow = page.getByRole('row', { name: waitingGuest })
  const plainRow = page.getByRole('row', { name: plainGuest })
  const openRow = page.getByRole('row', { name: openGuest })
  const acceptName = `Zabilježi prihvaćanje telefonom: ${waitingGuest}`

  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(waitingRow.getByRole('button', { name: acceptName })).toBeVisible()
  await expect(waitingRow.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(plainRow.getByRole('button', { name: /Zabilježi prihvaćanje telefonom/ })).toHaveCount(0)
  await expect(plainRow.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(openRow.getByRole('button', { name: /Zabilježi prihvaćanje telefonom/ })).toHaveCount(0)
  await expect(openRow.getByRole('cell', { name: 'Nedodijeljeno', exact: true })).toBeVisible()
  await expect(openRow.getByRole('button', { name: `Dodijeli: ${openGuest}` })).toBeVisible()

  await waitingRow.getByRole('button', { name: acceptName }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Zabilježi prihvaćanje telefonom')
  await expect(dialog).toContainText('Ovo bilježi prihvaćanje potvrđeno s vozačem telefonom.')
  await expect(dialog).toContainText(waitingGuest)
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(dialog.locator('textarea, input')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(acceptPosts).toBe(0)
  expect(mail).toEqual([])
  await expect(waitingRow.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  expect(await dayRide(page, waiting.day, waitingGuest)).toMatchObject({ state: 'assigned', mustAccept: true })

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await waitingRow.getByRole('button', { name: acceptName }).click()
  await expect(dialog).toContainText('Ovo bilježi prihvaćanje potvrđeno s vozačem telefonom.')
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(acceptPosts).toBe(0)

  await switchLocale(page, 'en')
  const englishName = `Record acceptance by phone: ${waitingGuest}`
  await expect(waitingRow.getByRole('button', { name: englishName })).toBeVisible()
  await expect(plainRow.getByRole('button', { name: /Record acceptance by phone/ })).toHaveCount(0)
  await expect(openRow.getByRole('button', { name: /Record acceptance by phone/ })).toHaveCount(0)
  await waitingRow.getByRole('button', { name: englishName }).click()
  await expect(dialog).toContainText('Record acceptance by phone')
  await expect(dialog).toContainText('This records acceptance confirmed with the driver by phone.')
  await expect(dialog).toContainText(waitingGuest)
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await expect(dialog.locator('textarea, input')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()

  const acceptedResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${waiting.rideId}/accept-by-phone`) && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Record acceptance', exact: true }).click()
  const response = await acceptedResponse
  expect(response.status()).toBe(200)
  expect(response.request().postDataJSON()).toEqual({})
  expect(acceptPosts).toBe(1)
  expect(mail).toEqual([])

  await expect(dialog).toBeHidden()
  await expect(waitingRow.getByRole('cell', { name: 'Accepted', exact: true })).toBeVisible()
  await expect(waitingRow.getByRole('button', { name: englishName })).toHaveCount(0)
  await expect(waitingRow.getByRole('cell', { name: mustDriver, exact: true })).toBeVisible()
  await expect(waitingRow.getByRole('cell', { name: mustPlate, exact: true })).toBeVisible()
  await expect(plainRow.getByRole('cell', { name: 'Assigned', exact: true })).toBeVisible()
  expect(await dayRide(page, waiting.day, waitingGuest)).toMatchObject({ state: 'accepted', mustAccept: true })
  expect(await dayRide(page, plain.day, plainGuest)).toMatchObject({ state: 'assigned', mustAccept: false })
  expect(await dayRide(page, open.day, openGuest)).toMatchObject({ state: 'unassigned', mustAccept: null })

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(waitingRow.getByRole('cell', { name: 'Accepted', exact: true })).toBeVisible()

  await switchLocale(page, 'hr')
  await expect(waitingRow.getByRole('cell', { name: 'Prihvaćeno', exact: true })).toBeVisible()
  await expect(waitingRow.getByRole('button', { name: acceptName })).toHaveCount(0)
  await expect(plainRow.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(openRow.getByRole('cell', { name: 'Nedodijeljeno', exact: true })).toBeVisible()

  await page.reload()
  await expect(waitingRow.getByRole('cell', { name: 'Prihvaćeno', exact: true })).toBeVisible()
  await expect(waitingRow.getByRole('button', { name: acceptName })).toHaveCount(0)
  await expect(plainRow.getByRole('cell', { name: 'Dodijeljeno', exact: true })).toBeVisible()
  await expect(openRow.getByRole('cell', { name: 'Nedodijeljeno', exact: true })).toBeVisible()
  expect(acceptPosts).toBe(1)
  expect(mail).toEqual([])
})

test('the office marks a ride done, and the audit log names that person', async ({ page }) => {
  const tenant = await seedTenant('day-mark-done')
  const mail: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
  })

  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const mustDriverId = await addDriver(page, 'Marko Must', '+385911110200')
  expect((await page.request.patch(`/api/drivers/${mustDriverId}`, { data: { mustAccept: true } })).ok()).toBeTruthy()
  const freeDriverId = await addDriver(page, 'Ana Free', '+385911110201')
  const mustVehicleId = await addVehicle(page, 'DU200AA')
  const freeVehicleId = await addVehicle(page, 'DU200BB')
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Kraj', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Kraj', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Dolazak Kraj', kind: 'hotel' },
  }))
  const places = { clientId, startLocationId, endLocationId }
  const waiting = await recordTodayRide(page, 'Nika Ceka', '10:00', places)
  const plain = await recordTodayRide(page, 'Lara Gotova', '11:00', places)
  const open = await recordTodayRide(page, 'Ema Open', '12:00', places)
  await assignRide(page, waiting.rideId, mustDriverId, mustVehicleId)
  await assignRide(page, plain.rideId, freeDriverId, freeVehicleId)

  await page.getByRole('link', { name: 'Transferi' }).click()
  const waitingRow = page.getByRole('row', { name: 'Nika Ceka' })
  const plainRow = page.getByRole('row', { name: 'Lara Gotova' })
  const openRow = page.getByRole('row', { name: 'Ema Open' })
  const doneName = 'Označi obavljenom: Lara Gotova'

  await expect(waitingRow.getByRole('button', { name: doneName })).toHaveCount(0)
  await expect(openRow.getByRole('button', { name: /Označi obavljenom/ })).toHaveCount(0)
  await expect(plainRow.getByRole('button', { name: doneName })).toBeVisible()
  await plainRow.getByRole('button', { name: doneName }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Ovo zatvara vožnju. Daljnja promjena nije moguća.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await dayRide(page, plain.day, 'Lara Gotova')).toMatchObject({ state: 'assigned', mustAccept: false })
  expect(mail).toEqual([])

  await switchTheme(page, 'dark')
  await switchLocale(page, 'en')
  await expect(page.locator('html')).toHaveClass(/dark/)
  const englishName = 'Mark done: Lara Gotova'
  await plainRow.getByRole('button', { name: englishName }).click()
  await expect(dialog).toContainText('This closes the ride. No further change is possible.')
  const doneResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${plain.rideId}/done`) && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Mark done', exact: true }).click()
  expect((await doneResponse).status()).toBe(200)
  await expect(plainRow.getByRole('cell', { name: 'Done', exact: true })).toBeVisible()
  await expect(plainRow.getByRole('button', { name: englishName })).toHaveCount(0)
  expect(await dayRide(page, plain.day, 'Lara Gotova')).toMatchObject({ state: 'done', mustAccept: false })
  expect(await dayRide(page, waiting.day, 'Nika Ceka')).toMatchObject({ state: 'assigned', mustAccept: true })
  expect(await dayRide(page, open.day, 'Ema Open')).toMatchObject({ state: 'unassigned', mustAccept: null })
  expect(mail).toEqual([])

  await page.getByRole('link', { name: 'Audit log' }).click()
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  const doneRow = page.getByRole('row', { name: 'Ride marked done' })
  await expect(doneRow).toContainText(tenant.adminName)
  await expect(doneRow).toContainText('Ana Free')
})

test('the office cancels a ride, the row stays, and the audit log names that person', async ({ page }) => {
  const tenant = await seedTenant('day-cancel-ride')
  const mail: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
  })

  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const driverId = await addDriver(page, 'Iva Vozi', '+385911110300')
  const vehicleId = await addVehicle(page, 'DU300AA')
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Otkaz', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Otkaz', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Dolazak Otkaz', kind: 'hotel' },
  }))
  const places = { clientId, startLocationId, endLocationId }
  const open = await recordTodayRide(page, 'Ema Slobodna', '09:00', places)
  const held = await recordTodayRide(page, 'Luka Drzi', '10:00', places)
  const finished = await recordTodayRide(page, 'Mia Gotova', '11:00', places)
  await assignRide(page, held.rideId, driverId, vehicleId)
  await assignRide(page, finished.rideId, driverId, vehicleId)
  expect((await page.request.post(`/api/rides/${finished.rideId}/done`, { data: {} })).ok()).toBeTruthy()

  await page.getByRole('link', { name: 'Transferi' }).click()
  const openRow = page.getByRole('row', { name: 'Ema Slobodna' })
  const heldRow = page.getByRole('row', { name: 'Luka Drzi' })
  const finishedRow = page.getByRole('row', { name: 'Mia Gotova' })
  const cancelName = 'Otkaži vožnju: Luka Drzi'

  await expect(openRow.getByRole('button', { name: 'Otkaži vožnju: Ema Slobodna' })).toBeVisible()
  await expect(heldRow.getByRole('button', { name: cancelName })).toBeVisible()
  await expect(finishedRow.getByRole('button', { name: /Otkaži vožnju/ })).toHaveCount(0)
  await heldRow.getByRole('button', { name: cancelName }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Ovo otkazuje vožnju. Ostaje u evidenciji, a daljnja promjena nije moguća.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await dayRide(page, held.day, 'Luka Drzi')).toMatchObject({ state: 'assigned', mustAccept: false })
  expect(mail).toEqual([])

  await switchTheme(page, 'dark')
  await switchLocale(page, 'en')
  await expect(page.locator('html')).toHaveClass(/dark/)
  const englishName = 'Cancel ride: Luka Drzi'
  await heldRow.getByRole('button', { name: englishName }).click()
  await expect(dialog).toContainText('This calls the ride off. It stays on record, and no further change is possible.')
  const cancelResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${held.rideId}/cancel`) && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Cancel ride', exact: true }).click()
  expect((await cancelResponse).status()).toBe(200)
  await expect(heldRow.getByRole('cell', { name: 'Cancelled', exact: true })).toBeVisible()
  await expect(heldRow.getByRole('button', { name: englishName })).toHaveCount(0)
  expect(await dayRide(page, held.day, 'Luka Drzi')).toMatchObject({
    state: 'cancelled',
    mustAccept: false,
  })
  expect(await dayRide(page, open.day, 'Ema Slobodna')).toMatchObject({ state: 'unassigned' })
  expect(mail).toEqual([])

  await page.getByRole('link', { name: 'Audit log' }).click()
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  const cancelledRow = page.getByRole('row', { name: 'Ride cancelled' })
  await expect(cancelledRow).toContainText(tenant.adminName)
  await expect(cancelledRow).toContainText('Iva Vozi')
})

test('the office marks a no-show before the wait, and the audit log names that person', async ({ page }) => {
  const tenant = await seedTenant('day-mark-noshow')
  const mail: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
  })

  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  expect((await page.request.patch('/api/tenant-settings', {
    data: { airportWaitMinutes: 1440, elsewhereWaitMinutes: 1440 },
  })).ok()).toBeTruthy()
  const mustDriverId = await addDriver(page, 'Marko Ceka', '+385911110210')
  expect((await page.request.patch(`/api/drivers/${mustDriverId}`, { data: { mustAccept: true } })).ok()).toBeTruthy()
  const freeDriverId = await addDriver(page, 'Ana Nedo', '+385911110211')
  const mustVehicleId = await addVehicle(page, 'DU210AA')
  const freeVehicleId = await addVehicle(page, 'DU210BB')
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Nedo', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Nedo', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Dolazak Nedo', kind: 'hotel' },
  }))
  const places = { clientId, startLocationId, endLocationId }
  const waiting = await recordTodayRide(page, 'Nika Ceka', '10:00', places)
  const plain = await recordTodayRide(page, 'Lara Nedo', '12:00', places)
  const open = await recordTodayRide(page, 'Ema Open', '14:00', places)
  await assignRide(page, waiting.rideId, mustDriverId, mustVehicleId)
  await assignRide(page, plain.rideId, freeDriverId, freeVehicleId)

  await page.getByRole('link', { name: 'Transferi' }).click()
  const waitingRow = page.getByRole('row', { name: 'Nika Ceka' })
  const plainRow = page.getByRole('row', { name: 'Lara Nedo' })
  const openRow = page.getByRole('row', { name: 'Ema Open' })
  const noShowName = 'Označi nedolazak: Lara Nedo'

  await expect(waitingRow.getByRole('button', { name: /Označi nedolazak/ })).toHaveCount(0)
  await expect(openRow.getByRole('button', { name: /Označi nedolazak/ })).toHaveCount(0)
  await expect(plainRow.getByRole('button', { name: noShowName })).toBeVisible()
  await plainRow.getByRole('button', { name: noShowName }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Naknada se ne bilježi.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await dayRide(page, plain.day, 'Lara Nedo')).toMatchObject({ state: 'assigned', mustAccept: false })
  expect(mail).toEqual([])

  await switchTheme(page, 'dark')
  await switchLocale(page, 'en')
  await expect(page.locator('html')).toHaveClass(/dark/)
  const englishName = 'Mark no-show: Lara Nedo'
  await plainRow.getByRole('button', { name: englishName }).click()
  await expect(dialog).toContainText('No fee is recorded')
  const marked = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${plain.rideId}/no-show`) && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Mark no-show', exact: true }).click()
  expect((await marked).status()).toBe(200)
  await expect(plainRow.getByRole('cell', { name: 'No-show', exact: true })).toBeVisible()
  await expect(plainRow.getByRole('button', { name: englishName })).toHaveCount(0)
  expect(await dayRide(page, plain.day, 'Lara Nedo')).toMatchObject({ state: 'no-show', mustAccept: false })
  expect(await dayRide(page, waiting.day, 'Nika Ceka')).toMatchObject({ state: 'assigned', mustAccept: true })
  expect(await dayRide(page, open.day, 'Ema Open')).toMatchObject({ state: 'unassigned', mustAccept: null })
  expect(mail).toEqual([])

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(plainRow.getByRole('cell', { name: 'No-show', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Audit log' }).click()
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
  const earlyRow = page.getByRole('row', { name: 'No-show before the wait' })
  await expect(earlyRow).toContainText(tenant.adminName)
  await expect(earlyRow).toContainText('Ana Nedo')
})
