import type { Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // One instant for the seed and the board, including across 05:00.
  await pinOperationalClock(page)
})

/**
 * Transfers quick filters, within-day search, and the seven-day unassigned
 * note (issue #255). The phone project runs the @phone block as well.
 */

const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function record(page: Page, guest: string, day: string, wall: string, spot: {
  clientId: string
  startLocationId: string
  endLocationId: string
}, extra?: { flightNumber?: string, tabla?: string, clientReference?: string }) {
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId: spot.clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
      startLocationId: spot.startLocationId,
      endLocationId: spot.endLocationId,
      passengerCount: 1,
      guestName: guest,
      flightNumber: extra?.flightNumber ?? null,
      price: 10,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
      tabla: extra?.tabla ?? '',
      clientReference: extra?.clientReference ?? null,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const body = await recorded.json() as { ride: { id: string } }
  return body.ride.id
}

test('search, Client, and Driver filters narrow the day and stay in the URL', async ({ page }) => {
  const tenant = await seedTenant('transfers-filters')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Filter', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Filter', kind: 'hotel' })
  const anaClient = await createdId(page, '/api/clients', { name: 'Agencija Ana', kind: 'agency' })
  const ivoClient = await createdId(page, '/api/clients', { name: 'Hotel Ivo', kind: 'hotel' })
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Marko Filter',
    kind: 'own',
    phone: '+385910000255',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'ZG255AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const day = addCalendarDays(operationalDay(page), 1)
  const ana = {
    clientId: anaClient,
    startLocationId,
    endLocationId,
  }
  const rideId = await record(page, 'Ana Traži', day, '12:00', ana, { flightNumber: 'OU111', tabla: 'ANA', clientReference: 'V-19' })
  await record(page, 'Ivo Traži', day, '13:00', {
    clientId: ivoClient,
    startLocationId,
    endLocationId,
  }, { flightNumber: 'OU222', tabla: 'IVO' })
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, { data: { version: 0, driverId, vehicleId } })
  expect(assigned.ok()).toBeTruthy()

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'Sve (2)', exact: true })).toBeVisible()
  const search = page.getByRole('searchbox', { name: 'Traži u danu' })
  await search.fill('OU222')
  await expect(page).toHaveURL(/search=OU222/)
  await expect(page.getByRole('button', { name: 'Sve (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Ivo Traži' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Ana Traži' })).toHaveCount(0)
  await search.fill('ANA')
  await expect(page.getByRole('row', { name: 'Ana Traži' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Ivo Traži' })).toHaveCount(0)
  await search.fill('V-19')
  await expect(page.getByRole('row', { name: 'Ana Traži' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Ivo Traži' })).toHaveCount(0)

  await search.fill('')
  await expect(page.getByRole('button', { name: 'Sve (2)', exact: true })).toBeVisible()
  const client = page.getByRole('button', { name: 'Naručitelj', exact: true })
  await chooseOption(page, client, 'Hotel Ivo')
  await expect(page).toHaveURL(new RegExp(`client=${ivoClient}`))
  await expect(page.getByRole('button', { name: 'Sve (1)', exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Ivo Traži' })).toBeVisible()
  await page.getByRole('button', { name: /^Hitno \(/ }).click()
  await expect(page).toHaveURL(/filter=urgent/)
  await page.goBack()
  await expect(page).not.toHaveURL(/filter=/)
  await expect(page).toHaveURL(new RegExp(`client=${ivoClient}`))
  await expect(page.getByRole('row', { name: 'Ivo Traži' })).toBeVisible()

  await page.goto(`/transfers?day=${day}&driver=${driverId}`)
  await expect(page.getByRole('row', { name: 'Ana Traži' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Ivo Traži' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sve (1)', exact: true })).toBeVisible()
})

test('the seven-day note names tomorrow and opens that day', async ({ page }) => {
  const tenant = await seedTenant('transfers-note')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Bilješka', kind: 'individual' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Bilješka', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Bilješka', kind: 'hotel' })
  const spot = { clientId, startLocationId, endLocationId }
  const today = operationalDay(page)
  const tomorrow = addCalendarDays(today, 1)
  const tooFar = addCalendarDays(today, 8)
  await record(page, 'Danas Gost', today, '12:00', spot)
  await record(page, 'Sutra Gost', tomorrow, '12:00', spot)
  await record(page, 'Kasnije Gost', tooFar, '12:00', spot)

  await page.goto('/transfers')
  await hydrated(page)
  const note = page.getByRole('group', { name: 'Nedodijeljeno u idućih sedam dana' })
  await expect(note).toBeVisible()
  await expect(note.getByRole('button', { name: 'sutra 1', exact: true })).toBeVisible()
  await expect(note.getByRole('button')).toHaveCount(1)
  await note.getByRole('button', { name: 'sutra 1', exact: true }).click()
  await expect(page.locator('#transfer-day')).toHaveValue(tomorrow)
  await expect(page.getByRole('row', { name: 'Sutra Gost' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Kasnije Gost' })).toHaveCount(0)
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`filters and the unassigned note follow ${theme} and pass axe`, async ({ page }) => {
      const tenant = await seedTenant(`transfers-filters-phone-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const clientId = await createdId(page, '/api/clients', { name: 'Klijent Telefon', kind: 'agency' })
      const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Telefon', kind: 'address' })
      const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Telefon', kind: 'hotel' })
      const today = operationalDay(page)
      await record(page, 'Sutra Telefon', addCalendarDays(today, 1), '15:00', {
        clientId,
        startLocationId,
        endLocationId,
      })
      const phone = (page.viewportSize()?.width ?? 1280) < 1024
      if (!phone)
        await page.setViewportSize({ width: 1366, height: 768 })
      await page.goto('/transfers')
      await hydrated(page)
      await expect(page.getByRole('searchbox', { name: 'Traži u danu' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'sutra 1', exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('searchbox', { name: 'Search this day' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'tomorrow 1', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Client', exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})
