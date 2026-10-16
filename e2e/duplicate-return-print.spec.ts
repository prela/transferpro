import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Duplicate, return journey, and print the day (issue #260). Saving a
 * return creates a second Transfer. Print stays light in the dark theme.
 */

const licence = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

test('a return journey saved from the detail is a separate Transfer', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('return-journey')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const startLocationId = await createdId(page, '/api/locations', { name: 'Zračna luka Povratak', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Povratak', kind: 'hotel' })
  const clientId = await createdId(page, '/api/clients', { name: 'Agencija Povratak', kind: 'agency' })
  const day = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 1)
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 2,
      guestName: 'Ana Povratak',
      flightNumber: 'OU384',
      price: 40,
      payment: 'cash',
      airportMark: true,
      luggageCount: 2,
      childSeatCount: 1,
      tabla: 'ANA',
      clientReference: 'V-19',
      note: 'Nazovi recepciju',
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const created = await recorded.json() as { transfer: { id: string } }
  const transferId = created.transfer.id

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await page.getByRole('row', { name: 'Ana Povratak' }).click()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Dupliciraj', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Povratni transfer', exact: true }).click()

  const form = page.getByRole('dialog')
  await expect(form.getByRole('button', { name: 'Polazište', exact: true })).toContainText('Hotel Povratak')
  await expect(form.getByRole('button', { name: 'Odredište', exact: true })).toContainText('Zračna luka Povratak')
  await expect(form.getByLabel('Ime gosta')).toHaveValue('Ana Povratak')
  await expect(form.getByLabel('Referenca naručitelja')).toHaveValue('V-19')
  await expect(form.getByLabel('Putnici')).toHaveValue('2')
  await expect(form.getByLabel('Cijena (EUR)')).toHaveValue('')
  await expect(form.getByRole('combobox', { name: 'Plaćanje' })).toContainText('Gotovina')
  await expect(form.getByLabel('Vrijeme preuzimanja')).toHaveValue('')
  await expect(form.getByLabel('Broj leta')).toHaveValue('')
  await expect(form.getByLabel('Tabla')).toHaveValue('')
  await expect(form.getByLabel('Prtljaga')).toHaveValue('2')
  await expect(form.getByLabel('Dječje sjedalice')).toHaveValue('1')
  await expect(form.getByLabel('Napomena')).toHaveValue('')
  await expect(form.getByRole('checkbox', { name: 'Aerodromsko preuzimanje' })).not.toBeChecked()

  const before = await page.request.get(`/api/transfers?date=${day}`)
  expect((await before.json() as { rides: unknown[] }).rides).toHaveLength(1)

  await form.getByLabel('Cijena (EUR)').fill('40')
  await form.getByLabel('Vrijeme preuzimanja').fill(`${day}T16:00`)
  await form.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Notifications (F8)' }).getByText('Zabilježeno.')).toBeVisible()

  const after = await page.request.get(`/api/transfers?date=${day}`)
  const rides = (await after.json() as {
    rides: {
      transferId: string
      startLocationId: string
      endLocationId: string
      clientReference: string | null
      flightNumber: string | null
      tabla: string
      guestName: string
    }[]
  }).rides
  expect(rides).toHaveLength(2)
  const original = rides.find(ride => ride.transferId === transferId)
  const returned = rides.find(ride => ride.transferId !== transferId)
  expect(original).toMatchObject({
    startLocationId,
    endLocationId,
    guestName: 'Ana Povratak',
    flightNumber: 'OU384',
    tabla: 'ANA',
    clientReference: 'V-19',
  })
  expect(returned).toMatchObject({
    startLocationId: endLocationId,
    endLocationId: startLocationId,
    guestName: 'Ana Povratak',
    flightNumber: null,
    tabla: '',
    clientReference: 'V-19',
  })
  expect(JSON.stringify(returned)).not.toContain(transferId)
})

test('printing in the dark theme stays light and groups unassigned Rides last', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('print-day')
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Tisak', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Tisak', kind: 'hotel' })
  const clientId = await createdId(page, '/api/clients', { name: 'Agencija Tisak', kind: 'agency' })
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Marko Tisak',
    kind: 'own',
    phone: '+385912600260',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  const earlyVehicle = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU260BB',
    kind: 'fixed',
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const laterVehicle = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU260AA',
    kind: 'fixed',
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const day = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 1)
  const spot = { clientId, startLocationId, endLocationId }

  async function record(guest: string, wall: string, tabla: string, note: string): Promise<string> {
    const response = await page.request.post('/api/transfers', {
      data: {
        ...spot,
        pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
        passengerCount: 1,
        guestName: guest,
        price: 10,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
        tabla,
        note,
      },
    })
    expect(response.ok()).toBeTruthy()
    const body = await response.json() as { ride: { id: string } }
    return body.ride.id
  }

  const earlyRide = await record('Rani Gost', '09:00', 'RANO', 'Rana napomena')
  const laterRide = await record('Kasni Gost', '11:00', 'KASNO', 'Kasna napomena')
  await record('Slobodni Gost', '08:00', 'SLOBODNO', 'Bez vozila')
  expect((await page.request.post(`/api/rides/${earlyRide}/assign`, { data: { driverId, vehicleId: earlyVehicle } })).ok()).toBeTruthy()
  expect((await page.request.post(`/api/rides/${laterRide}/assign`, { data: { driverId, vehicleId: laterVehicle } })).ok()).toBeTruthy()

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'Ispiši dan', exact: true })).toBeVisible()
  await page.emulateMedia({ media: 'print' })

  const sheet = page.locator('.transfer-day-print')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { level: 2 })).toHaveText(['DU260BB', 'DU260AA', 'Nedodijeljeno'])
  await expect(sheet.getByRole('row', { name: /Rani Gost/ })).toContainText('RANO')
  await expect(sheet.getByRole('row', { name: /Rani Gost/ })).toContainText('Rana napomena')
  await expect(sheet.getByRole('row', { name: /Slobodni Gost/ })).toContainText('Bez vozila')
  const ink = await sheet.evaluate((element) => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, color: style.color }
  })
  expect(ink).toEqual({ backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(17, 17, 17)' })

  await page.emulateMedia({ media: 'screen' })
  await switchLocale(page, 'en')
  await expect(page.getByRole('button', { name: 'Print the day', exact: true })).toBeVisible()
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.transfer-day-print').getByRole('heading', { level: 2 })).toHaveText(['DU260BB', 'DU260AA', 'Unassigned'])
})
