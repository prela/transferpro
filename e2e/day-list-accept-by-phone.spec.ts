import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, signOut, useTheme } from './fixtures/ui'

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
 * Records one Ride for today. The day list opens on that day.
 * Returns the pickup day and the Ride id.
 */
async function recordTodayRide(page: Page, guest: string, wall: string, places: {
  clientId: string
  startLocationId: string
  endLocationId: string
}): Promise<{ day: string, rideId: string }> {
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
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

  await page.getByRole('button', { name: 'Tamna tema' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await waitingRow.getByRole('button', { name: acceptName }).click()
  await expect(dialog).toContainText('Ovo bilježi prihvaćanje potvrđeno s vozačem telefonom.')
  await expect(dialog.getByRole('textbox')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(acceptPosts).toBe(0)

  await page.getByRole('button', { name: 'English', exact: true }).click()
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

  await page.getByRole('button', { name: 'Light theme' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(waitingRow.getByRole('cell', { name: 'Accepted', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
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
