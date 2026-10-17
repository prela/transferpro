import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { formatInstant } from '../shared/format-instant'
import { noShowWaitBounds, noShowWindowLabels } from '../shared/no-show'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

/**
 * The next Ride is already open. A later Ride is a compact row until the
 * Driver taps it (ADR-0038).
 */
async function showRide(page: Page, guest: string): Promise<Locator> {
  const article = page.locator('article').filter({ hasText: guest })
  // The next Ride has no expand button. Wait until the row is on the page
  // before deciding, or a lead card still loading looks like a closed row.
  await expect(article).toBeVisible()
  const heading = article.getByRole('heading', { name: guest, exact: true })
  if (await heading.count() === 0)
    await article.getByRole('button', { expanded: false }).click()
  await expect(heading).toBeVisible()
  return article
}

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

async function createdId(response: { ok: () => boolean, status: () => number, text: () => Promise<string>, json: () => Promise<unknown> }): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

/**
 * The owner role. A card that must start done or accepted is set here.
 * The copied
 * flag stays as assignment wrote it unless a conflict test turns it off.
 */
async function setRideState(rideId: string, state: 'done' | 'accepted') {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    await pool.query(`update app.rides set state = $2 where id = $1`, [rideId, state])
  }
  finally {
    await pool.end()
  }
}

/**
 * The office took the Ride back. The phone still shows the old card until
 * the Driver acts, and that accept is a 404.
 */
async function releaseRide(rideId: string) {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    await pool.query(
      `update app.rides
       set state = 'unassigned', driver_id = null, vehicle_id = null, must_accept = null
       where id = $1`,
      [rideId],
    )
  }
  finally {
    await pool.end()
  }
}

/** The copy taken at assignment. Turning it off makes the next accept a 409. */
async function setCopiedMustAccept(rideId: string, mustAccept: boolean) {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    await pool.query(`update app.rides set must_accept = $2 where id = $1`, [rideId, mustAccept])
  }
  finally {
    await pool.end()
  }
}

async function rideRow(rideId: string): Promise<{
  state: string
  must_accept: boolean | null
  driver_id: string | null
  vehicle_id: string | null
}> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    const result = await pool.query<{
      state: string
      must_accept: boolean | null
      driver_id: string | null
      vehicle_id: string | null
    }>(
      `select state, must_accept, driver_id, vehicle_id from app.rides where id = $1`,
      [rideId],
    )
    const row = result.rows[0]
    if (!row)
      throw new Error('ride is missing')
    return row
  }
  finally {
    await pool.end()
  }
}

test('a driver sees only their own rides, cash shows the fare, and the app is installable', async ({ page }) => {
  const tenant = await seedTenant('driver-rides')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const cardAt = instantFromWallClock(`${day}T09:00`, 'Europe/Zagreb')
  const cashAt = instantFromWallClock(`${day}T15:30`, 'Europe/Zagreb')
  const invoiceAt = instantFromWallClock(`${day}T18:00`, 'Europe/Zagreb')
  const doneAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb')

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  // Phone width puts Transferi on the bottom bar. There is no sidebar slideover.
  const bar = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(bar.getByRole('link', { name: 'Transferi', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Otvori bočnu traku', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Sljedeća vožnja' })).toHaveCount(0)

  const licence = '2031-01-01'
  const ownDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Vlastiti',
      kind: 'own',
      phone: '+385911110301',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const otherDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Iva Druga',
      kind: 'own',
      phone: '+385911110302',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU300AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  // Iva's Ride runs at the same time, so it needs its own Vehicle (ADR-0029).
  const otherVehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU301AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Vozač', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak', kind: 'airport' },
  }))
  const addressedStartId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Čilipi', kind: 'airport', address: 'Čilipi 1' },
  }))
  const placed = await page.request.patch(`/api/locations/${addressedStartId}`, {
    data: { place: { provider: 'google', placeRef: 'ChIJexactGate' } },
  })
  if (!placed.ok())
    throw new Error(`${placed.status()} ${await placed.text()}`)
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Park', kind: 'hotel', address: 'Masarykov put 1' },
  }))

  async function record(guest: string, pickupAt: Date, payment: 'cash' | 'card' | 'invoice_to_agency', price: number, extra?: { flightNumber?: string, airportMark?: boolean, passengerCount?: number, luggageCount?: number, childSeatCount?: number, note?: string, tabla?: string, startLocationId?: string }) {
    const recorded = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt: pickupAt.toISOString(),
        startLocationId: extra?.startLocationId ?? startLocationId,
        endLocationId,
        passengerCount: extra?.passengerCount ?? 1,
        guestName: guest,
        flightNumber: extra?.flightNumber ?? null,
        price,
        payment,
        airportMark: extra?.airportMark ?? false,
        luggageCount: extra?.luggageCount ?? 0,
        childSeatCount: extra?.childSeatCount ?? 0,
        note: extra?.note ?? null,
        tabla: extra?.tabla ?? '',
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    const body = await recorded.json() as { ride: { id: string } }
    return body.ride.id
  }

  async function assign(rideId: string, assignee: string, vehicle = vehicleId) {
    const response = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { driverId: assignee, vehicleId: vehicle },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
  }

  const cardRide = await record('Nika Plastika', cardAt, 'card', 99, {
    note: 'Voucher fare 99.00',
    tabla: 'GOSPOĐA HORVAT',
    startLocationId: addressedStartId,
  })
  await assign(cardRide, ownDriverId)
  const cashRide = await record('Nika Sunce', cashAt, 'cash', 42.5, {
    flightNumber: 'OU 384',
    airportMark: true,
    passengerCount: 3,
    luggageCount: 2,
    childSeatCount: 1,
  })
  await assign(cashRide, ownDriverId)
  const invoiceRide = await record('Nika Agencija', invoiceAt, 'invoice_to_agency', 80)
  await assign(invoiceRide, ownDriverId)
  const otherRide = await record('Nika Druga', cashAt, 'cash', 15)
  await assign(otherRide, otherDriverId, otherVehicleId)
  // Same Driver and Vehicle, so it sits between the card and the cash Ride (ADR-0029).
  const doneRide = await record('Nika Kraj', doneAt, 'cash', 11)
  await assign(doneRide, ownDriverId)
  await setRideState(doneRide, 'done')
  // The card still shows the place and the plate after both are archived.
  expect((await page.request.post(`/api/locations/${endLocationId}/archive`)).ok()).toBeTruthy()
  expect((await page.request.post(`/api/vehicles/${vehicleId}/archive`)).ok()).toBeTruthy()

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('heading', { name: 'Sljedeća vožnja' })).toBeVisible()
  const cashCard = await showRide(page, 'Nika Sunce')
  const cardCard = await showRide(page, 'Nika Plastika')
  const invoiceCard = await showRide(page, 'Nika Agencija')
  await expect(cashCard.getByRole('heading', { name: 'Nika Sunce' })).toBeVisible()
  await expect(cardCard.getByRole('heading', { name: 'Nika Plastika' })).toBeVisible()
  await expect(invoiceCard.getByRole('heading', { name: 'Nika Agencija' })).toBeVisible()
  await expect(page.getByText('Nika Druga')).toHaveCount(0)
  await expect(page.getByText('Nika Kraj')).toHaveCount(0)
  await expect(cashCard.getByText(formatInstant(cashAt, 'Europe/Zagreb', 'hr'))).toBeVisible()
  await expect(cashCard.getByText('Polazak')).toBeVisible()
  await expect(cashCard.getByText('Hotel Park')).toBeVisible()
  await expect(cashCard.getByText('3', { exact: true })).toBeVisible()
  await expect(cashCard.getByText('OU 384')).toBeVisible()
  await expect(cashCard.getByText('Zračna luka')).toBeVisible()
  await expect(cardCard.getByText('Zračna luka')).toHaveCount(0)
  await expect(cashCard.getByText('Klijent Vozač')).toBeVisible()
  await expect(cashCard.getByText('Agencija')).toBeVisible()
  await expect(cashCard.getByText('Masarykov put 1')).toBeVisible()
  // The start has no address, so the card has one address line, on the end.
  await expect(cashCard.getByText('Adresa', { exact: true })).toHaveCount(1)
  await expect(cashCard.locator('div').filter({ hasText: /^Prtljaga/ }).locator('dd')).toHaveText('2')
  await expect(cashCard.locator('div').filter({ hasText: /^Dječje sjedalice/ }).locator('dd')).toHaveText('1')
  await expect(cashCard.getByText('DU300AA')).toBeVisible()
  await expect(cashCard.getByText('Tabla')).toHaveCount(0)
  await expect(cashCard.getByText('Napomena')).toHaveCount(0)
  await expect(cashCard.getByText('Arhivirano')).toHaveCount(0)
  await expect(cardCard.getByText('Čilipi 1')).toBeVisible()
  await expect(cardCard.getByText('Masarykov put 1')).toBeVisible()
  const cardStartLink = cardCard.getByRole('link', { name: 'Otvori u kartama' }).first()
  const cardEndLink = cardCard.getByRole('link', { name: 'Otvori u kartama' }).nth(1)
  await expect(cardStartLink).toHaveAttribute('href', /google\.com\/maps\/dir\//)
  await expect(cardStartLink).toHaveAttribute('href', /destination_place_id=ChIJexactGate/)
  await expect(cardStartLink).toHaveAttribute('target', '_blank')
  await expect(cardEndLink).toHaveAttribute('href', /Masarykov\+put\+1/)
  await expect(cardEndLink).not.toHaveAttribute('href', /destination_place_id/)
  const cashStartLink = cashCard.getByRole('link', { name: 'Otvori u kartama' }).first()
  const cashEndLink = cashCard.getByRole('link', { name: 'Otvori u kartama' }).nth(1)
  await expect(cashStartLink).toHaveAttribute('href', /destination=Polazak/)
  await expect(cashStartLink).not.toHaveAttribute('href', /destination_place_id/)
  await expect(cashEndLink).toHaveAttribute('href', /Masarykov\+put\+1/)
  await expect(cashEndLink).not.toHaveAttribute('href', /destination_place_id/)
  const invoiceStartLink = invoiceCard.getByRole('link', { name: 'Otvori u kartama' }).first()
  const invoiceEndLink = invoiceCard.getByRole('link', { name: 'Otvori u kartama' }).nth(1)
  await expect(invoiceStartLink).toHaveAttribute('href', /destination=Polazak/)
  await expect(invoiceEndLink).toHaveAttribute('href', /Masarykov\+put\+1/)
  await expect(invoiceEndLink).not.toHaveAttribute('href', /destination_place_id/)
  await expect(cardCard.getByText('Adresa', { exact: true })).toHaveCount(2)
  await expect(cardCard.getByText('Voucher fare 99.00')).toBeVisible()
  await expect(cardCard.getByText('GOSPOĐA HORVAT')).toBeVisible()
  await expect(cardCard.getByRole('button', { name: 'Prikaži tablu' })).toBeVisible()
  await expect(cashCard.getByRole('button', { name: 'Prikaži tablu' })).toHaveCount(0)
  await expect(cardCard.locator('div').filter({ hasText: /^Prtljaga/ }).locator('dd')).toHaveText('0')
  await expect(cardCard.locator('div').filter({ hasText: /^Dječje sjedalice/ }).locator('dd')).toHaveText('0')
  await expect(cardCard.getByText('DU300AA')).toBeVisible()
  await expect(cardCard.getByText('Arhivirano')).toHaveCount(0)
  await expect(cashCard.getByText('42,50 EUR')).toBeVisible()
  await expect(cashCard.getByText('Gotovina')).toBeVisible()
  await expect(cardCard.getByText('Cijena', { exact: true })).toHaveCount(0)
  await expect(cardCard.getByText('99,00 EUR')).toHaveCount(0)
  await expect(cardCard.getByText('Gotovina')).toHaveCount(0)
  await expect(cardCard.getByText('Kartica')).toHaveCount(0)
  await expect(cardCard.getByText('Card')).toHaveCount(0)
  await expect(invoiceCard.getByText('80,00 EUR')).toHaveCount(0)
  await expect(invoiceCard.getByText('80.00')).toHaveCount(0)
  await expect(invoiceCard.getByText('Račun agenciji')).toHaveCount(0)
  await expect(invoiceCard.getByText('Gotovina')).toHaveCount(0)
  await expect(cashCard.getByText('Prihvaćeno')).toHaveCount(0)
  await expect(cashCard.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(cardCard.getByText('Prihvaćeno')).toHaveCount(0)
  await expect(cardCard.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(invoiceCard.getByText('Prihvaćeno')).toHaveCount(0)
  await expect(invoiceCard.getByText('Čeka na prihvat')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)

  await switchLocale(page, 'en')
  await showRide(page, 'Nika Sunce')
  await showRide(page, 'Nika Agencija')
  await expect(page.getByRole('heading', { name: 'Next ride' })).toBeVisible()
  await expect(cashCard.getByRole('link', { name: 'Open in maps' })).toHaveCount(2)
  await expect(invoiceCard.getByRole('link', { name: 'Open in maps' })).toHaveCount(2)
  await expect(cashCard.getByText('Cash')).toBeVisible()
  await expect(cashCard.getByText('42.50 EUR')).toBeVisible()
  await expect(cashCard.getByText('Airport')).toBeVisible()
  await expect(cashCard.getByText('Client')).toBeVisible()
  await expect(cashCard.getByText('Agency')).toBeVisible()
  await expect(cashCard.getByText('Address')).toBeVisible()
  await expect(cashCard.getByText('Luggage')).toBeVisible()
  await expect(cashCard.getByText('Child seats')).toBeVisible()
  await expect(cashCard.getByText('Registration plate')).toBeVisible()
  await expect(cashCard.getByText('Meet sign')).toHaveCount(0)
  await expect(cardCard.getByText('Address', { exact: true })).toHaveCount(2)
  await expect(cardCard.getByText('99.00 EUR')).toHaveCount(0)
  await expect(cardCard.getByText('Meet sign', { exact: true })).toBeVisible()
  await expect(cardCard.getByRole('button', { name: 'Show the meet sign' })).toBeVisible()
  await expect(cashCard.getByRole('button', { name: 'Show the meet sign' })).toHaveCount(0)
  await expect(cardCard.getByText('Note')).toBeVisible()
  await expect(cardCard.getByText('GOSPOĐA HORVAT')).toBeVisible()
  await expect(cardCard.getByText('Price', { exact: true })).toHaveCount(0)
  await expect(cardCard.getByText('Card')).toHaveCount(0)
  await expect(invoiceCard.getByText('80.00')).toHaveCount(0)
  await expect(invoiceCard.getByText('Invoice to agency')).toHaveCount(0)
  await expect(invoiceCard.getByText('Cash')).toHaveCount(0)
  await expect(cashCard.getByText('Accepted')).toHaveCount(0)
  await expect(cashCard.getByText('Waiting on acceptance')).toHaveCount(0)
  await expect(cardCard.getByText('Accepted')).toHaveCount(0)
  await expect(cardCard.getByText('Waiting on acceptance')).toHaveCount(0)
  await expect(invoiceCard.getByText('Accepted')).toHaveCount(0)
  await expect(invoiceCard.getByText('Waiting on acceptance')).toHaveCount(0)

  await switchTheme(page, 'dark')
  await showRide(page, 'Nika Sunce')
  await showRide(page, 'Nika Agencija')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(cashCard.getByRole('heading', { name: 'Nika Sunce' })).toBeVisible()
  await expect(cashCard.getByText('Masarykov put 1')).toBeVisible()
  await expect(cardCard.getByText('GOSPOĐA HORVAT')).toBeVisible()
  await expect(cardCard.getByText('Čilipi 1')).toBeVisible()
  await expect(cardCard.getByText('Price', { exact: true })).toHaveCount(0)
  await expect(cardCard.getByText('99.00 EUR')).toHaveCount(0)

  const manifestLink = page.locator('link[rel="manifest"]')
  await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest')
  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBeTruthy()
  expect(manifest.headers()['content-type']).toContain('application/manifest+json')
  const body = await manifest.json() as { name: string, display: string, icons: Array<{ sizes: string }> }
  expect(body.name).toBe('Transferpro')
  expect(body.display).toBe('standalone')
  expect(body.icons.map(icon => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect((await page.request.get('/icons/icon-192.png')).ok()).toBeTruthy()
  expect((await page.request.get('/icons/icon-512.png')).ok()).toBeTruthy()
  await page.waitForFunction(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return registration !== undefined
  })
})

test('a driver sees which rides are waiting on acceptance and which are accepted', async ({ page }) => {
  const tenant = await seedTenant('driver-waiting')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Cekanje')
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const waitingAt = instantFromWallClock(`${day}T09:00`, 'Europe/Zagreb')
  const acceptedAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb')
  const plainAt = instantFromWallClock(`${day}T16:00`, 'Europe/Zagreb')

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const ownDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Ceka',
      kind: 'own',
      phone: '+385911110401',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU301AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Cekanje', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Cekanje', kind: 'address' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Cekanje', kind: 'hotel' },
  }))

  async function record(guest: string, pickupAt: Date, payment: 'cash' | 'card', price: number) {
    const recorded = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt: pickupAt.toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: guest,
        flightNumber: null,
        price,
        payment,
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    const body = await recorded.json() as { ride: { id: string } }
    return body.ride.id
  }

  async function assign(rideId: string) {
    const response = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { driverId: ownDriverId, vehicleId },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
  }

  async function setMustAccept(mustAccept: boolean) {
    const response = await page.request.patch(`/api/drivers/${ownDriverId}`, {
      data: { mustAccept },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
  }

  await setMustAccept(true)
  const waitingRide = await record('Nika Ceka', waitingAt, 'card', 33)
  await assign(waitingRide)
  const acceptedRide = await record('Nika Da', acceptedAt, 'cash', 18.5)
  await assign(acceptedRide)
  await setRideState(acceptedRide, 'accepted')
  await setMustAccept(false)
  const plainRide = await record('Nika Ne', plainAt, 'cash', 7)
  await assign(plainRide)

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  const waiting = await showRide(page, 'Nika Ceka')
  const accepted = await showRide(page, 'Nika Da')
  const plain = await showRide(page, 'Nika Ne')
  await expect(waiting.getByText('Čeka na prihvat')).toBeVisible()
  await expect(waiting.getByText('Prihvaćeno')).toHaveCount(0)
  await expect(waiting.getByText('33,00 EUR')).toHaveCount(0)
  await expect(waiting.getByText('33.00')).toHaveCount(0)
  await expect(waiting.getByText('Kartica')).toHaveCount(0)
  await expect(waiting.getByText('Gotovina')).toHaveCount(0)
  await expect(accepted.getByText('Prihvaćeno')).toBeVisible()
  await expect(accepted.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(accepted.getByText('18,50 EUR')).toBeVisible()
  await expect(accepted.getByText('Gotovina')).toBeVisible()
  await expect(plain.getByText('7,00 EUR')).toBeVisible()
  await expect(plain.getByText('Gotovina')).toBeVisible()
  await expect(plain.getByText('Prihvaćeno')).toHaveCount(0)
  await expect(plain.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(waiting.getByRole('button', { name: 'Prihvati', exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Odbij', exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Obavljeno', exact: true })).toHaveCount(0)
  await expect(accepted.getByRole('button', { name: 'Obavljeno', exact: true })).toBeVisible()
  await expect(plain.getByRole('button', { name: 'Obavljeno', exact: true })).toBeVisible()

  await switchTheme(page, 'dark')
  await showRide(page, 'Nika Da')
  await showRide(page, 'Nika Ne')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(waiting.getByText('Čeka na prihvat')).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Prihvati', exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Odbij', exact: true })).toBeVisible()
  await expect(accepted.getByText('Prihvaćeno')).toBeVisible()
  await expect(plain.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(plain.getByText('Prihvaćeno')).toHaveCount(0)

  await switchLocale(page, 'en')
  await showRide(page, 'Nika Da')
  await showRide(page, 'Nika Ne')
  await expect(waiting.getByText('Waiting on acceptance')).toBeVisible()
  await expect(waiting.getByText('Accepted')).toHaveCount(0)
  await expect(waiting.getByText('33.00')).toHaveCount(0)
  await expect(waiting.getByText('Card')).toHaveCount(0)
  await expect(accepted.getByText('Accepted')).toBeVisible()
  await expect(accepted.getByText('Waiting on acceptance')).toHaveCount(0)
  await expect(accepted.getByText('18.50 EUR')).toBeVisible()
  await expect(accepted.getByText('Cash')).toBeVisible()
  await expect(plain.getByText('7.00 EUR')).toBeVisible()
  await expect(plain.getByText('Cash')).toBeVisible()
  await expect(plain.getByText('Accepted')).toHaveCount(0)
  await expect(plain.getByText('Waiting on acceptance')).toHaveCount(0)
  await expect(waiting.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Decline', exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
  await expect(accepted.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
  await expect(plain.getByRole('button', { name: 'Done', exact: true })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)

  await switchTheme(page, 'light')
  await showRide(page, 'Nika Da')
  await showRide(page, 'Nika Ne')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(waiting.getByText('Waiting on acceptance')).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
  await expect(waiting.getByRole('button', { name: 'Decline', exact: true })).toBeVisible()
  await expect(accepted.getByText('Accepted')).toBeVisible()
  await expect(plain.getByText('Waiting on acceptance')).toHaveCount(0)
})

test('@phone a driver accepts a waiting ride, and a conflict reloads the list', async ({ page }) => {
  const tenant = await seedTenant('driver-accept')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Prihvat')
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const acceptAt = instantFromWallClock(`${day}T10:00`, 'Europe/Zagreb')
  const lostAt = instantFromWallClock(`${day}T11:30`, 'Europe/Zagreb')
  const conflictAt = instantFromWallClock(`${day}T13:00`, 'Europe/Zagreb')
  const nextAt = instantFromWallClock(`${day}T16:00`, 'Europe/Zagreb')
  const mail: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
  })

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const ownDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Prihvat',
      kind: 'own',
      phone: '+385911110501',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU302AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Prihvat', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Prihvat', kind: 'address' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Prihvat', kind: 'hotel' },
  }))

  async function record(guest: string, pickupAt: Date) {
    const recorded = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt: pickupAt.toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: guest,
        flightNumber: null,
        price: 20,
        payment: 'card',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    const body = await recorded.json() as { ride: { id: string } }
    return body.ride.id
  }

  async function assign(rideId: string) {
    const response = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { driverId: ownDriverId, vehicleId },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
  }

  const mustAccept = await page.request.patch(`/api/drivers/${ownDriverId}`, {
    data: { mustAccept: true },
  })
  if (!mustAccept.ok())
    throw new Error(`${mustAccept.status()} ${await mustAccept.text()}`)
  const acceptRide = await record('Nika Prihvat', acceptAt)
  await assign(acceptRide)
  const lostRide = await record('Nika Izgubljena', lostAt)
  await assign(lostRide)
  const conflictRide = await record('Nika Sukob', conflictAt)
  await assign(conflictRide)
  const nextRide = await record('Nika Dalje', nextAt)
  await assign(nextRide)

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  const accepted = await showRide(page, 'Nika Prihvat')
  const lost = await showRide(page, 'Nika Izgubljena')
  const conflicted = await showRide(page, 'Nika Sukob')
  const onward = await showRide(page, 'Nika Dalje')
  await expect(accepted.getByRole('button', { name: 'Prihvati', exact: true })).toBeVisible()
  await expect(accepted.getByRole('button', { name: 'Odbij', exact: true })).toBeVisible()
  await expect(conflicted.getByRole('button', { name: 'Prihvati', exact: true })).toBeVisible()
  await expect(conflicted.getByRole('button', { name: 'Odbij', exact: true })).toBeVisible()
  await expect(accepted.getByText('Čeka na prihvat')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  const acceptedResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${acceptRide}/accept`) && response.request().method() === 'POST',
  )
  await accepted.getByRole('button', { name: 'Prihvati', exact: true }).click()
  expect((await acceptedResponse).status()).toBe(200)
  await expect(accepted.getByRole('heading', { name: 'Nika Prihvat' })).toBeVisible()
  await expect(accepted.getByText('Prihvaćeno')).toBeVisible()
  await expect(accepted.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(accepted.getByRole('button', { name: 'Obavljeno', exact: true })).toBeVisible()
  await expect(page.getByText(/Ažurirano u \d{2}:\d{2}/)).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await rideRow(acceptRide)).toMatchObject({ state: 'accepted', must_accept: true })
  expect(mail).toEqual([])

  await expect(lost.getByRole('button', { name: 'Prihvati', exact: true })).toBeVisible()
  await releaseRide(lostRide)
  const lostResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${lostRide}/accept`) && response.request().method() === 'POST',
  )
  await lost.getByRole('button', { name: 'Prihvati', exact: true }).click()
  expect((await lostResponse).status()).toBe(404)
  await expect(page.getByRole('alert')).toContainText('Ovu vožnju više nije moguće prihvatiti.')
  await expect(lost).toHaveCount(0)
  expect(await rideRow(lostRide)).toMatchObject({ state: 'unassigned', must_accept: null })
  expect(mail).toEqual([])

  await setCopiedMustAccept(conflictRide, false)
  const conflictResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${conflictRide}/accept`) && response.request().method() === 'POST',
  )
  await conflicted.getByRole('button', { name: 'Prihvati', exact: true }).click()
  expect((await conflictResponse).status()).toBe(409)
  await expect(page.getByRole('alert')).toContainText('Ovu vožnju više nije moguće prihvatiti.')
  await expect(conflicted.getByRole('heading', { name: 'Nika Sukob' })).toBeVisible()
  await expect(conflicted.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(conflicted.getByText('Prihvaćeno')).toHaveCount(0)
  await expect(conflicted.getByRole('button', { name: 'Obavljeno', exact: true })).toBeVisible()
  expect(await rideRow(conflictRide)).toMatchObject({ state: 'assigned', must_accept: false })
  expect(mail).toEqual([])

  // The alert stays through the next tap. It leaves only after that accept succeeds,
  // and the list has caught up with the Ride that was still waiting.
  await expect(onward.getByRole('button', { name: 'Prihvati', exact: true })).toBeVisible()
  let releaseNext = () => {}
  const holdNext = new Promise<void>((resolve) => {
    releaseNext = resolve
  })
  await page.route(`**/api/rides/${nextRide}/accept`, async (route) => {
    await holdNext
    await route.continue()
  })
  const nextResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${nextRide}/accept`) && response.request().method() === 'POST',
  )
  const upcomingResponse = page.waitForResponse(response =>
    response.url().includes('/api/rides/upcoming') && response.request().method() === 'GET' && response.ok(),
  )
  try {
    await onward.getByRole('button', { name: 'Prihvati', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Ovu vožnju više nije moguće prihvatiti.')
  }
  finally {
    releaseNext()
  }
  expect((await nextResponse).status()).toBe(200)
  await upcomingResponse
  await page.unroute(`**/api/rides/${nextRide}/accept`)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(onward.getByText('Prihvaćeno')).toBeVisible()
  await expect(onward.getByRole('button', { name: 'Obavljeno', exact: true })).toBeVisible()
  await expect(conflicted.getByRole('button', { name: 'Obavljeno', exact: true })).toBeVisible()
  expect(await rideRow(nextRide)).toMatchObject({ state: 'accepted', must_accept: true })
  expect(mail).toEqual([])

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(accepted.getByText('Prihvaćeno')).toBeVisible()

  // The conflict alert does not survive the Profile round-trip. Arm the same
  // Ride again so the English screen shows the failure in the saved Locale.
  await setCopiedMustAccept(conflictRide, true)
  await switchLocale(page, 'en')
  await showRide(page, 'Nika Sukob')
  await expect(accepted.getByText('Accepted')).toBeVisible()
  await expect(conflicted.getByRole('button', { name: 'Accept', exact: true })).toBeVisible()
  await setCopiedMustAccept(conflictRide, false)
  const englishConflict = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${conflictRide}/accept`) && response.request().method() === 'POST',
  )
  await conflicted.getByRole('button', { name: 'Accept', exact: true }).click()
  expect((await englishConflict).status()).toBe(409)
  await expect(page.getByRole('alert')).toContainText('This ride can no longer be accepted.')
  await expect(accepted.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
  await expect(conflicted.getByRole('button', { name: 'Done', exact: true })).toBeVisible()

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(accepted.getByText('Accepted')).toBeVisible()
})

test('@phone a driver marks a ride done and it leaves the upcoming list', async ({ page }) => {
  const tenant = await seedTenant('driver-mark-done')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Kraj')
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const pickupAt = instantFromWallClock(`${day}T15:00`, 'Europe/Zagreb')
  const mail: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
  })

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const licence = '2030-01-01'
  const ownDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Nika Kraj',
      kind: 'own',
      phone: '+385911110023',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU023AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Kraj', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Kraj', kind: 'address' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Kraj', kind: 'hotel' },
  }))
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: pickupAt.toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: 'Gost Kraj',
      flightNumber: null,
      price: 20,
      payment: 'card',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { driverId: ownDriverId, vehicleId },
  })
  if (!assigned.ok())
    throw new Error(`${assigned.status()} ${await assigned.text()}`)

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  const card = page.locator('article').filter({ hasText: 'Gost Kraj' })
  await expect(card.getByRole('button', { name: 'Obavljeno', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Obavljeno', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Ovo zatvara vožnju. Daljnja promjena nije moguća.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await rideRow(rideId)).toMatchObject({ state: 'assigned', must_accept: false })

  await switchLocale(page, 'en')
  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await card.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(dialog).toContainText('This closes the ride. No further change is possible.')
  const doneResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${rideId}/done`) && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Mark done', exact: true }).click()
  expect((await doneResponse).status()).toBe(200)
  await expect(card).toHaveCount(0)
  await expect(page.getByText('You have no upcoming rides.')).toBeVisible()
  expect(await rideRow(rideId)).toMatchObject({ state: 'done', must_accept: false })
  expect(mail).toEqual([])
})

test('@phone a driver declines an assigned ride and the board names them', async ({ page }) => {
  const tenant = await seedTenant('driver-decline')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Odbij')
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const pickupAt = instantFromWallClock(`${day}T16:00`, 'Europe/Zagreb')
  const mail: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
  })

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const licence = '2030-01-01'
  const ownDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Nika Odbij',
      kind: 'own',
      phone: '+385911110024',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU024AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Odbij', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Odbij', kind: 'address' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Odbij', kind: 'hotel' },
  }))
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: pickupAt.toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: 'Gost Odbij',
      flightNumber: null,
      price: 20,
      payment: 'card',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { driverId: ownDriverId, vehicleId },
  })
  if (!assigned.ok())
    throw new Error(`${assigned.status()} ${await assigned.text()}`)

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  const card = page.locator('article').filter({ hasText: 'Gost Odbij' })
  await expect(card.getByRole('button', { name: 'Odbij', exact: true })).toBeVisible()
  await card.getByRole('button', { name: 'Odbij', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Vožnja se vraća na ploču bez vozača i bez vozila.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await rideRow(rideId)).toMatchObject({ state: 'assigned', driver_id: ownDriverId, vehicle_id: vehicleId })

  await switchLocale(page, 'en')
  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await card.getByRole('button', { name: 'Decline', exact: true }).click()
  await expect(dialog).toContainText('The ride returns to the board with no driver and no vehicle.')
  const declineResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${rideId}/decline`) && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Decline', exact: true }).click()
  expect((await declineResponse).status()).toBe(200)
  await expect(card).toHaveCount(0)
  await expect(page.getByText('You have no upcoming rides.')).toBeVisible()
  expect(await rideRow(rideId)).toMatchObject({
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
    must_accept: null,
  })
  expect(mail).toEqual([])

  // Sign-out copy is Croatian until the locale changes. The Driver just switched to English.
  await switchLocale(page, 'hr')
  await signOut(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Transferi', exact: true }).click()
  await page.locator('#transfer-day').fill(day)
  await expect(page.getByRole('row', { name: 'Gost Odbij' })).toContainText('Odbio: Nika Odbij')
  // The alert sits above the day list. The returned Ride stays on the board.
  await expect(page.getByRole('cell', { name: /^Gost Odbij/ })).toBeVisible()

  await switchLocale(page, 'en')
  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.locator('#transfer-day').fill(day)
  await expect(page.getByRole('row', { name: 'Gost Odbij' })).toContainText('Declined: Nika Odbij')
  await expect(page.getByRole('cell', { name: /^Gost Odbij/ })).toBeVisible()
})

test('a driver with no linked Driver sees an empty list', async ({ page }) => {
  const tenant = await seedTenant('driver-rides-empty')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Prazan')
  await useTheme(page, 'dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, driver.email, driver.password, tenant.name)
  await expect(page.getByRole('heading', { name: 'Sljedeća vožnja' })).toBeVisible()
  await expect(page.getByText('Nemate nadolazećih vožnji.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Transferi' })).toHaveCount(0)
  await switchLocale(page, 'en')
  await expect(page.getByText('You have no upcoming rides.')).toBeVisible()
})

test('@phone a driver marks a no-show after the wait and it leaves the upcoming list', async ({ page }) => {
  const tenant = await seedTenant('driver-mark-noshow')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Nedo')
  const mail: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('resend.com'))
      mail.push(request.url())
  })

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const licence = '2030-01-01'
  const ownDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Nika Nedo',
      kind: 'own',
      phone: '+385911110025',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU025AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Nedo', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Nedo', kind: 'address' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Nedo', kind: 'hotel' },
  }))
  async function record(guest: string, pickupAt: string) {
    const recorded = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt,
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: guest,
        flightNumber: null,
        price: 20,
        payment: 'card',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
    const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { driverId: ownDriverId, vehicleId },
    })
    if (!assigned.ok())
      throw new Error(`${assigned.status()} ${await assigned.text()}`)
    return rideId
  }
  const earlyAt = new Date(Date.now() + 3 * 60 * 60 * 1000)
  const readyId = await record('Gost Nedo', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
  const earlyId = await record('Gost Rano', earlyAt.toISOString())
  const earlyWindow = noShowWaitBounds({
    airport: false,
    pickupAt: earlyAt,
    landingAt: null,
    airportWaitMinutes: 90,
    elsewhereWaitMinutes: 25,
  })

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  const ready = await showRide(page, 'Gost Nedo')
  const early = await showRide(page, 'Gost Rano')
  const readyNoShow = ready.getByRole('button', { name: /^Nedolazak/ })
  const earlyNoShow = early.getByRole('button', { name: /^Nedolazak/ })
  await expect(readyNoShow).toBeEnabled()
  await expect(earlyNoShow).toBeDisabled()
  const earlyLabels = noShowWindowLabels(earlyWindow.from, earlyWindow.until, 'Europe/Zagreb', 'hr')
  await expect(earlyNoShow).toContainText(earlyLabels.from)
  await expect(earlyNoShow).toContainText(earlyLabels.until)
  await readyNoShow.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Ovo zatvara vožnju. Naknada se ne bilježi.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await rideRow(readyId)).toMatchObject({ state: 'assigned', must_accept: false })

  await switchLocale(page, 'en')
  await switchTheme(page, 'dark')
  await showRide(page, 'Gost Rano')
  await expect(page.locator('html')).toHaveClass(/dark/)
  const earlyEnglish = early.getByRole('button', { name: /^No-show/ })
  await expect(earlyEnglish).toBeDisabled()
  const earlyEnglishLabels = noShowWindowLabels(earlyWindow.from, earlyWindow.until, 'Europe/Zagreb', 'en')
  await expect(earlyEnglish).toContainText(earlyEnglishLabels.from)
  await expect(earlyEnglish).toContainText(earlyEnglishLabels.until)
  await ready.getByRole('button', { name: /^No-show/ }).click()
  await expect(dialog).toContainText('This closes the ride. No fee is recorded.')
  const marked = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${readyId}/no-show`) && response.request().method() === 'POST',
  )
  await dialog.getByRole('button', { name: 'Mark no-show', exact: true }).click()
  expect((await marked).status()).toBe(200)
  await expect(ready).toHaveCount(0)
  await expect(early.getByRole('button', { name: /^No-show/ })).toBeDisabled()
  expect(await rideRow(readyId)).toMatchObject({ state: 'no-show', must_accept: false })
  expect(await rideRow(earlyId)).toMatchObject({ state: 'assigned', must_accept: false })
  expect(mail).toEqual([])

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(early).toBeVisible()
})

test('the driver list refreshes after 60 seconds while visible and stays quiet while hidden', async ({ page }) => {
  const tenant = await seedTenant('driver-refresh')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Sat')
  const reads = { upcoming: 0 }
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/rides/upcoming')
      reads.upcoming += 1
  })
  await page.clock.install({ time: new Date('2026-10-15T09:59:00.000Z') })
  await signIn(page, driver.email, driver.password, tenant.name)
  await expect.poll(() => reads.upcoming).toBeGreaterThan(0)
  await page.clock.pauseAt(new Date('2026-10-15T10:00:00.000Z'))
  const automatic = page.getByRole('switch', { name: 'Automatsko osvježavanje' })
  await automatic.click()
  await expect(automatic).not.toBeChecked()
  await automatic.click()
  await expect(automatic).toBeChecked()
  const afterOpen = reads.upcoming
  await page.clock.fastForward(60_000)
  await expect.poll(() => reads.upcoming).toBeGreaterThan(afterOpen)
  await expect(page.getByText(/Ažurirano u \d{2}:\d{2}/)).toBeVisible()

  await setTabVisibility(page, 'hidden')
  const whileHidden = reads.upcoming
  await page.clock.fastForward(120_000)
  expect(reads.upcoming).toBe(whileHidden)
})

// @phone: the phone project runs this block as well as the desktop project.
test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the driver phone follows ${theme} and passes axe`, async ({ page }) => {
      const tenant = await seedTenant(`driver-axe-${theme}`)
      const driver = await seedMember(tenant.tenantId, 'driver', 'Tema')
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const licence = '2031-01-01'
      const driverId = await createdId(await page.request.post('/api/drivers', {
        data: {
          name: 'Marko Tema',
          kind: 'own',
          phone: theme === 'dark' ? '+385911110267' : '+385911110266',
          drivingLicenceExpiresOn: licence,
          transportLicenceExpiresOn: licence,
          memberUserId: driver.userId,
        },
      }))
      const vehicleId = await createdId(await page.request.post('/api/vehicles', {
        data: {
          registrationPlate: theme === 'dark' ? 'DU267AA' : 'DU266AA',
          kind: 'fixed',
          registrationExpiresOn: licence,
          technicalInspectionExpiresOn: licence,
          insuranceExpiresOn: licence,
        },
      }))
      const clientId = await createdId(await page.request.post('/api/clients', {
        data: { name: 'Klijent Tema', kind: 'individual' },
      }))
      const startLocationId = await createdId(await page.request.post('/api/locations', {
        data: { name: 'Polazak Tema', kind: 'address' },
      }))
      const endLocationId = await createdId(await page.request.post('/api/locations', {
        data: { name: 'Hotel Tema', kind: 'hotel' },
      }))
      const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
      const recorded = await page.request.post('/api/transfers', {
        data: {
          clientId,
          pickupAt: instantFromWallClock(`${day}T11:00`, 'Europe/Zagreb').toISOString(),
          startLocationId,
          endLocationId,
          passengerCount: 1,
          guestName: 'Nika Tema',
          price: 12.5,
          payment: 'cash',
          airportMark: false,
          luggageCount: 0,
          childSeatCount: 0,
        },
      })
      if (!recorded.ok())
        throw new Error(`${recorded.status()} ${await recorded.text()}`)
      const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
      const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
        data: { driverId, vehicleId },
      })
      if (!assigned.ok())
        throw new Error(`${assigned.status()} ${await assigned.text()}`)
      await signOut(page)
      await signIn(page, driver.email, driver.password, tenant.name)
      await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Sljedeća vožnja' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Nika Tema' })).toBeVisible()
      await expect(page.getByText('12,50 EUR')).toBeVisible()
      await expect(page.getByRole('switch', { name: 'Automatsko osvježavanje' })).toBeChecked()
      await expect(page.getByRole('button', { name: 'Profil', exact: true })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Odjava', exact: true })).toHaveCount(0)
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('heading', { name: 'Next ride' })).toBeVisible()
        await expect(page.getByText('12.50 EUR')).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }

  test('@phone opening and closing the meet sign returns to the same ride and the text fits portrait and landscape', async ({ page }) => {
    await installWakeLock(page)
    await page.setViewportSize({ width: 390, height: 844 })
    const { later } = await seedMeetSign(page, 'driver-tabla-fit', '+385911110401', 'DU401AA', true)
    const article = await showRide(page, later)
    await article.scrollIntoViewIfNeeded()
    const scrollBefore = await page.evaluate(() => window.scrollY)
    await article.getByRole('button', { name: 'Prikaži tablu' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('GOSPOĐA HORVAT', { exact: true })).toBeVisible()
    await expectSignFits(page, 'GOSPOĐA HORVAT')
    expect(await wakeProbe(page)).toEqual({ requests: ['screen'], releases: 0 })

    await page.setViewportSize({ width: 844, height: 390 })
    await expectSignFits(page, 'GOSPOĐA HORVAT')
    expect(await wakeProbe(page)).toEqual({ requests: ['screen'], releases: 0 })

    await dialog.getByRole('button', { name: 'Zatvori', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(article.getByRole('heading', { name: later, exact: true })).toBeVisible()
    const scrollAfter = await page.evaluate(() => window.scrollY)
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(1)
    expect(await wakeProbe(page)).toEqual({ requests: ['screen'], releases: 1 })
  })

  test('@phone a browser without a wake lock still shows the meet sign', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        get() {
          return undefined
        },
      })
    })
    await seedMeetSign(page, 'driver-tabla-unsupported', '+385911110402', 'DU402AA')
    await page.getByRole('button', { name: 'Prikaži tablu' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('GOSPOĐA HORVAT', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '500' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Zatvori', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Nika Tabla', exact: true })).toBeVisible()
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`@phone the meet sign follows ${theme} and passes axe`, async ({ page }) => {
      await useTheme(page, theme)
      await seedMeetSign(page, `driver-tabla-axe-${theme}`, theme === 'dark' ? '+385911110404' : '+385911110403', theme === 'dark' ? 'DU404AA' : 'DU403AA')
      await page.getByRole('button', { name: 'Prikaži tablu' }).click()
      await expect(page.getByRole('dialog').getByText('GOSPOĐA HORVAT', { exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await page.getByRole('dialog').getByRole('button', { name: 'Zatvori', exact: true }).click()
        await switchLocale(page, 'en')
        await page.getByRole('button', { name: 'Show the meet sign' }).click()
        await expect(page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })).toBeVisible()
        await expect(page.getByRole('dialog').getByText('GOSPOĐA HORVAT', { exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})

interface WakeProbe {
  requests: string[]
  releases: number
}

/** Counts Screen Wake Lock requests in this browser. Installed before navigation. */
async function installWakeLock(page: Page) {
  await page.addInitScript(() => {
    const probe = { requests: [] as string[], releases: 0 }
    Object.assign(window, { __tpWakeLock: probe })
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        async request(type: string) {
          probe.requests.push(type)
          let released = false
          return {
            get released() {
              return released
            },
            async release() {
              released = true
              probe.releases += 1
            },
          }
        },
      },
    })
  })
}

async function wakeProbe(page: Page): Promise<WakeProbe> {
  return page.evaluate(() => {
    const probe = Reflect.get(window, '__tpWakeLock') as WakeProbe | undefined
    if (!probe)
      throw new Error('wake lock probe is missing')
    return { requests: [...probe.requests], releases: probe.releases }
  })
}

/** The sign's box stays inside the viewport, and the line itself is not clipped. */
async function expectSignFits(page: Page, text: string) {
  const sign = page.getByRole('dialog').getByText(text, { exact: true })
  await expect(sign).toBeVisible()
  const box = await sign.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport)
    throw new Error('meet sign box is missing')
  expect(box.x).toBeGreaterThanOrEqual(-1)
  expect(box.y).toBeGreaterThanOrEqual(-1)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)
  const clipped = await sign.evaluate(element => element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)
  expect(clipped).toBe(false)
}

/**
 * One Driver, and a Ride whose meet sign is GOSPOĐA HORVAT.
 * `later` adds an earlier Ride so the sign sits on a row below the lead.
 */
async function seedMeetSign(page: Page, slug: string, phone: string, plate: string, later = false) {
  const tenant = await seedTenant(slug)
  const driver = await seedMember(tenant.tenantId, 'driver', 'Tabla')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const licence = '2031-01-01'
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Tabla',
      kind: 'own',
      phone,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
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
    data: { name: 'Klijent Tabla', kind: 'individual' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Tabla', kind: 'address' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Tabla', kind: 'hotel' },
  }))
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  async function record(guest: string, hour: string, tabla: string) {
    const recorded = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T${hour}`, 'Europe/Zagreb').toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: guest,
        price: 12.5,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
        tabla,
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
    const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { driverId, vehicleId },
    })
    if (!assigned.ok())
      throw new Error(`${assigned.status()} ${await assigned.text()}`)
  }
  if (later)
    await record('Nika Prva', '09:00', '')
  await record('Nika Tabla', later ? '18:00' : '11:00', 'GOSPOĐA HORVAT')
  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  await expect(page.getByRole('heading', { name: 'Sljedeća vožnja' })).toBeVisible()
  return { later: 'Nika Tabla' }
}

async function setTabVisibility(page: Page, state: 'visible' | 'hidden') {
  await page.evaluate((next) => {
    const view = document as Document & { __tpVisibility?: 'visible' | 'hidden' }
    if (!Object.hasOwn(document, 'visibilityState')) {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get() {
          return view.__tpVisibility ?? 'visible'
        },
      })
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get() {
          return (view.__tpVisibility ?? 'visible') === 'hidden'
        },
      })
    }
    view.__tpVisibility = next
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}
