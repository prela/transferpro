import type { Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

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

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

/** Below 1024 px the day is a list of cards, not a table. */
function rideRow(page: Page, guest: string) {
  if (isPhone(page))
    return page.getByRole('listitem').filter({ hasText: guest })
  return page.getByRole('row', { name: guest })
}

async function record(page: Page, guest: string, day: string, wall: string, spot: {
  clientId: string
  startLocationId: string
  endLocationId: string
}, extra?: { flightNumber?: string, tabla?: string, clientReference?: string, passengerCount?: number }) {
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId: spot.clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
      startLocationId: spot.startLocationId,
      endLocationId: spot.endLocationId,
      passengerCount: extra?.passengerCount ?? 1,
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

test('state, vehicle, partner, and needs attention combine, stay in the URL, and keep a hidden urgent row in the count', async ({ page }) => {
  const tenant = await seedTenant('transfers-narrow')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Suženo', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Suženo', kind: 'hotel' })
  const clientId = await createdId(page, '/api/clients', { name: 'Agencija Suženo', kind: 'agency' })
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Marko Suženo',
    kind: 'own',
    phone: '+385910000546',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'ZG546AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const partnerId = await createdId(page, '/api/partners', { name: 'Prijevoz Suženo' })
  const spot = { clientId, startLocationId, endLocationId }
  const day = addCalendarDays(operationalDay(page), -1)
  const hidden = await record(page, 'Hitni Skriven', day, '12:00', spot, { flightNumber: 'OU546' })
  const shown = await record(page, 'Dodijeljeni Ostaje', day, '13:00', spot)
  const handed = await record(page, 'Predani Gost', day, '14:00', spot)
  expect(hidden).toBeTruthy()
  const assigned = await page.request.post(`/api/rides/${shown}/assign`, { data: { version: 0, driverId, vehicleId } })
  expect(assigned.ok()).toBeTruthy()
  const handedOff = await page.request.post(`/api/rides/${handed}/hand-off`, { data: { version: 0, partnerId } })
  expect(handedOff.ok()).toBeTruthy()

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'Hitno (3)', exact: true })).toBeVisible()
  const state = page.getByRole('button', { name: 'Stanje vožnje', exact: true })
  await chooseOption(page, state, 'Nedodijeljeno')
  await expect(page).toHaveURL(/rideState=unassigned/)
  await expect(page.getByRole('row', { name: 'Hitni Skriven' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Dodijeljeni Ostaje' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hitno (3)', exact: true })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Traži u danu' }).fill('predani')
  await expect(page).toHaveURL(/search=predani/)
  await expect(page.getByText('Nema vožnji za ovaj filtar.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hitno (3)', exact: true })).toBeVisible()
  await page.reload()
  await expect(page).toHaveURL(/rideState=unassigned/)
  await expect(page).toHaveURL(/search=predani/)
  await page.getByRole('button', { name: 'Očisti filtre', exact: true }).click()
  await expect(page).not.toHaveURL(/rideState=/)
  await expect(page.getByRole('row', { name: 'Predani Gost' })).toBeVisible()

  const compact = page.getByRole('row', { name: 'Hitni Skriven' })
  await expect(compact).not.toContainText('OU546')
  const expand = compact.getByRole('button', { name: /detalje: Hitni Skriven/ })
  await expect(expand).toHaveAttribute('aria-expanded', 'false')
  await expand.click()
  await expect(expand).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('region', { name: 'Detalji: Hitni Skriven' })).toContainText('OU546')
  await page.getByRole('button', { name: 'Proširi sve', exact: true }).click()
  await expect(page.getByRole('button', { name: /detalje: Dodijeljeni Ostaje/ })).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('button', { name: 'Skupi sve', exact: true }).click()
  await expect(expand).toHaveAttribute('aria-expanded', 'false')

  await chooseOption(page, page.getByRole('button', { name: 'Vozilo', exact: true }), 'ZG546AA')
  await expect(page).toHaveURL(new RegExp(`vehicle=${vehicleId}`))
  await expect(page.getByRole('row', { name: 'Dodijeljeni Ostaje' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Hitni Skriven' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Hitno (3)', exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('row', { name: 'Dodijeljeni Ostaje' })).toBeVisible()

  await chooseOption(page, page.getByRole('button', { name: 'Podizvođač', exact: true }), 'Prijevoz Suženo')
  await expect(page.getByText('Nema vožnji za ovaj filtar.')).toBeVisible()
  await page.getByRole('button', { name: 'Očisti filtre', exact: true }).click()

  await chooseOption(page, page.getByRole('button', { name: 'Podizvođač', exact: true }), 'Prijevoz Suženo')
  await expect(page).toHaveURL(new RegExp(`partner=${partnerId}`))
  await expect(page.getByRole('row', { name: 'Predani Gost' })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Hitni Skriven' })).toHaveCount(0)
  await page.getByRole('checkbox', { name: 'Treba pažnju' }).click()
  await expect(page).toHaveURL(/attention=1/)
  await expect(page.getByRole('row', { name: 'Predani Gost' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Treba pažnju' })).toBeChecked()
  await expectNoAxeViolations(page)
  await switchTheme(page, 'dark')
  await switchLocale(page, 'en')
  await expect(page.getByRole('checkbox', { name: 'Needs attention' })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Ride state', exact: true })).toBeVisible()
  await expectNoAxeViolations(page)
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
      if (!isPhone(page))
        await page.setViewportSize({ width: 1366, height: 768 })
      await page.goto('/transfers')
      await hydrated(page)
      await expect(page.getByRole('searchbox', { name: 'Traži u danu' })).toBeVisible()
      await expect(page.getByRole('checkbox', { name: 'Treba pažnju' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Stanje vožnje', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'sutra 1', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'sutra 1', exact: true }).click()
      const card = rideRow(page, 'Sutra Telefon')
      const expand = card.getByRole('button', { name: /detalje: Sutra Telefon/ })
      await expand.click()
      await expect(expand).toHaveAttribute('aria-expanded', 'true')
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('searchbox', { name: 'Search this day' })).toBeVisible()
        await expect(page.getByRole('checkbox', { name: 'Needs attention' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Ride state', exact: true })).toBeVisible()
        await expect(card.getByRole('button', { name: /details: Sutra Telefon/ })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Client', exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }

  /**
   * ADR-0064: every view count follows every active filter and never the
   * chosen view, while Hitno counts every Ride of the shown day. On the day
   * before, every Ride is urgent: the unassigned one is past its pickup and
   * the assigned ones carry the unclosed mark. Six passengers in a four-seat
   * Vehicle is the warning, so Upozorenja differs between the two Drivers.
   */
  test('view counts follow the Driver filter, never the chosen view, and Hitno counts the whole day', async ({ page }) => {
    const tenant = await seedTenant('transfers-counts')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Brojač', kind: 'address' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Brojač', kind: 'hotel' })
    const clientId = await createdId(page, '/api/clients', { name: 'Agencija Brojač', kind: 'agency' })
    const crew = async (name: string, phone: string, registrationPlate: string) => ({
      driverId: await createdId(page, '/api/drivers', {
        name,
        kind: 'own',
        phone,
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      }),
      vehicleId: await createdId(page, '/api/vehicles', {
        registrationPlate,
        kind: 'fixed',
        seatCount: 4,
        registrationExpiresOn: licence,
        technicalInspectionExpiresOn: licence,
        insuranceExpiresOn: licence,
      }),
    })
    const crewOne = await crew('Vozač Jedan', '+385910000587', 'ZG587AA')
    const crewTwo = await crew('Vozač Dva', '+385910000588', 'ZG587BB')
    const spot = { clientId, startLocationId, endLocationId }
    const day = addCalendarDays(operationalDay(page), -1)
    const crowded = await record(page, 'Gost Jedan Puni', day, '09:00', spot, { passengerCount: 6 })
    const calm = await record(page, 'Gost Jedan Mirni', day, '13:00', spot)
    const otherCrowded = await record(page, 'Gost Dva Puni', day, '09:00', spot, { passengerCount: 6 })
    await record(page, 'Gost Bez Vozača', day, '17:00', spot)
    for (const [rideId, assignment] of [[crowded, crewOne], [calm, crewOne], [otherCrowded, crewTwo]] as const) {
      const assigned = await page.request.post(`/api/rides/${rideId}/assign`, { data: { version: 0, ...assignment } })
      expect(assigned.ok()).toBeTruthy()
    }

    const expectChips = async (chips: readonly string[]) => {
      for (const name of chips)
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }

    await page.goto(`/transfers?day=${day}`)
    await hydrated(page)
    await expectChips(['Sve (4)', 'Hitno (4)', 'Upozorenja (2)', 'Nedodijeljeno (1)'])

    await chooseOption(page, page.getByRole('button', { name: 'Vozač', exact: true }), 'Vozač Jedan')
    await expect(page).toHaveURL(new RegExp(`driver=${crewOne.driverId}`))
    await expect(rideRow(page, 'Gost Jedan Puni')).toBeVisible()
    await expect(rideRow(page, 'Gost Jedan Mirni')).toBeVisible()
    await expect(rideRow(page, 'Gost Dva Puni')).toHaveCount(0)
    await expect(rideRow(page, 'Gost Bez Vozača')).toHaveCount(0)
    const filtered = ['Sve (2)', 'Hitno (4)', 'Upozorenja (1)', 'Nedodijeljeno (0)'] as const
    await expectChips(filtered)

    const unassigned = page.getByRole('button', { name: 'Nedodijeljeno (0)', exact: true })
    await unassigned.click()
    await expect(page).toHaveURL(/filter=unassigned/)
    await expect(unassigned).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Nema vožnji za ovaj filtar.')).toBeVisible()
    await expectChips(filtered)

    await page.getByRole('button', { name: 'Upozorenja (1)', exact: true }).click()
    await expect(page).toHaveURL(/filter=warnings/)
    await expect(rideRow(page, 'Gost Jedan Puni')).toBeVisible()
    await expect(rideRow(page, 'Gost Jedan Mirni')).toHaveCount(0)
    await expectChips(filtered)

    await switchLocale(page, 'en')
    await expect(page).toHaveURL(new RegExp(`driver=${crewOne.driverId}`))
    await expectChips(['All (2)', 'Urgent (4)', 'Warnings (1)', 'Unassigned (0)'])
  })
})
