import { expect, test } from '@playwright/test'
import pg from 'pg'
import { calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { formatInstant } from '../shared/format-instant'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

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
 * The owner role. Done has no phone command, so the spec sets that state.
 * Accepted is set the same way when a card must start accepted. The copied
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

async function rideRow(rideId: string): Promise<{ state: string, must_accept: boolean | null }> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    const result = await pool.query<{ state: string, must_accept: boolean | null }>(
      `select state, must_accept from app.rides where id = $1`,
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

  await useTheme(page, 'light')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  // Phone width keeps the sections in the slideover, not a row on the page.
  await page.getByRole('button', { name: 'Otvori bočnu traku', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Transferi' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Moje vožnje' })).toHaveCount(0)

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
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Vozač', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Park', kind: 'hotel' },
  }))

  async function record(guest: string, pickupAt: Date, payment: 'cash' | 'card' | 'invoice_to_agency', price: number, extra?: { flightNumber?: string, airportMark?: boolean, passengerCount?: number }) {
    const recorded = await page.request.post('/api/transfers', {
      data: {
        clientId,
        pickupAt: pickupAt.toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: extra?.passengerCount ?? 1,
        guestName: guest,
        flightNumber: extra?.flightNumber ?? null,
        price,
        payment,
        airportMark: extra?.airportMark ?? false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    if (!recorded.ok())
      throw new Error(`${recorded.status()} ${await recorded.text()}`)
    const body = await recorded.json() as { ride: { id: string } }
    return body.ride.id
  }

  async function assign(rideId: string, assignee: string) {
    const response = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { driverId: assignee, vehicleId },
    })
    if (!response.ok())
      throw new Error(`${response.status()} ${await response.text()}`)
  }

  const cardRide = await record('Nika Plastika', cardAt, 'card', 99)
  await assign(cardRide, ownDriverId)
  const cashRide = await record('Nika Sunce', cashAt, 'cash', 42.5, {
    flightNumber: 'OU 384',
    airportMark: true,
    passengerCount: 3,
  })
  await assign(cashRide, ownDriverId)
  const invoiceRide = await record('Nika Agencija', invoiceAt, 'invoice_to_agency', 80)
  await assign(invoiceRide, ownDriverId)
  const otherRide = await record('Nika Druga', cashAt, 'cash', 15)
  await assign(otherRide, otherDriverId)
  const doneRide = await record('Nika Kraj', cashAt, 'cash', 11)
  await assign(doneRide, ownDriverId)
  await setRideState(doneRide, 'done')

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('heading', { name: 'Moje vožnje' })).toBeVisible()
  const cashCard = page.locator('article').filter({ hasText: 'Nika Sunce' })
  const cardCard = page.locator('article').filter({ hasText: 'Nika Plastika' })
  const invoiceCard = page.locator('article').filter({ hasText: 'Nika Agencija' })
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
  await expect(cashCard.getByText('42,50 EUR')).toBeVisible()
  await expect(cashCard.getByText('Gotovina')).toBeVisible()
  await expect(cardCard.getByText('99,00 EUR')).toHaveCount(0)
  await expect(cardCard.getByText('99.00')).toHaveCount(0)
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
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible()
  await expect(cashCard.getByText('Cash')).toBeVisible()
  await expect(cashCard.getByText('42.50 EUR')).toBeVisible()
  await expect(cashCard.getByText('Airport')).toBeVisible()
  await expect(cardCard.getByText('99.00')).toHaveCount(0)
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
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(cashCard.getByRole('heading', { name: 'Nika Sunce' })).toBeVisible()
  await expect(cardCard.getByText('99.00')).toHaveCount(0)

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

  const waiting = page.locator('article').filter({ hasText: 'Nika Ceka' })
  const accepted = page.locator('article').filter({ hasText: 'Nika Da' })
  const plain = page.locator('article').filter({ hasText: 'Nika Ne' })
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
  await expect(waiting.getByRole('button')).toHaveCount(1)
  await expect(waiting.getByRole('button', { name: 'Prihvati vožnju', exact: true })).toBeVisible()
  await expect(accepted.getByRole('button')).toHaveCount(0)
  await expect(plain.getByRole('button')).toHaveCount(0)

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(waiting.getByText('Čeka na prihvat')).toBeVisible()
  await expect(waiting.getByRole('button')).toHaveCount(1)
  await expect(waiting.getByRole('button', { name: 'Prihvati vožnju', exact: true })).toBeVisible()
  await expect(accepted.getByText('Prihvaćeno')).toBeVisible()
  await expect(plain.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(plain.getByText('Prihvaćeno')).toHaveCount(0)

  await switchLocale(page, 'en')
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
  await expect(waiting.getByRole('button')).toHaveCount(1)
  await expect(waiting.getByRole('button', { name: 'Accept ride', exact: true })).toBeVisible()
  await expect(accepted.getByRole('button')).toHaveCount(0)
  await expect(plain.getByRole('button')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(waiting.getByText('Waiting on acceptance')).toBeVisible()
  await expect(waiting.getByRole('button')).toHaveCount(1)
  await expect(waiting.getByRole('button', { name: 'Accept ride', exact: true })).toBeVisible()
  await expect(accepted.getByText('Accepted')).toBeVisible()
  await expect(plain.getByText('Waiting on acceptance')).toHaveCount(0)
})

test('a driver accepts a waiting ride, and a conflict reloads the list', async ({ page }) => {
  const tenant = await seedTenant('driver-accept')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Prihvat')
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const acceptAt = instantFromWallClock(`${day}T10:00`, 'Europe/Zagreb')
  const conflictAt = instantFromWallClock(`${day}T13:00`, 'Europe/Zagreb')
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
  const conflictRide = await record('Nika Sukob', conflictAt)
  await assign(conflictRide)

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  const accepted = page.locator('article').filter({ hasText: 'Nika Prihvat' })
  const conflicted = page.locator('article').filter({ hasText: 'Nika Sukob' })
  await expect(accepted.getByRole('button')).toHaveCount(1)
  await expect(accepted.getByRole('button', { name: 'Prihvati vožnju', exact: true })).toBeVisible()
  await expect(conflicted.getByRole('button')).toHaveCount(1)
  await expect(conflicted.getByRole('button', { name: 'Prihvati vožnju', exact: true })).toBeVisible()
  await expect(accepted.getByText('Čeka na prihvat')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)

  const acceptedResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${acceptRide}/accept`) && response.request().method() === 'POST',
  )
  await accepted.getByRole('button', { name: 'Prihvati vožnju', exact: true }).click()
  expect((await acceptedResponse).status()).toBe(200)
  await expect(accepted.getByRole('heading', { name: 'Nika Prihvat' })).toBeVisible()
  await expect(accepted.getByText('Prihvaćeno')).toBeVisible()
  await expect(accepted.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(accepted.getByRole('button')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await rideRow(acceptRide)).toMatchObject({ state: 'accepted', must_accept: true })
  expect(mail).toEqual([])

  await setCopiedMustAccept(conflictRide, false)
  const conflictResponse = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${conflictRide}/accept`) && response.request().method() === 'POST',
  )
  await conflicted.getByRole('button', { name: 'Prihvati vožnju', exact: true }).click()
  expect((await conflictResponse).status()).toBe(409)
  await expect(page.getByRole('alert')).toContainText('Ovu vožnju više nije moguće prihvatiti.')
  await expect(conflicted.getByRole('heading', { name: 'Nika Sukob' })).toBeVisible()
  await expect(conflicted.getByText('Čeka na prihvat')).toHaveCount(0)
  await expect(conflicted.getByText('Prihvaćeno')).toHaveCount(0)
  await expect(conflicted.getByRole('button')).toHaveCount(0)
  expect(await rideRow(conflictRide)).toMatchObject({ state: 'assigned', must_accept: false })
  expect(mail).toEqual([])

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(accepted.getByText('Prihvaćeno')).toBeVisible()

  // The conflict alert does not survive the Profile round-trip. Arm the same
  // Ride again so the English screen shows the failure in the saved Locale.
  await setCopiedMustAccept(conflictRide, true)
  await switchLocale(page, 'en')
  await expect(accepted.getByText('Accepted')).toBeVisible()
  await expect(conflicted.getByRole('button', { name: 'Accept ride', exact: true })).toBeVisible()
  await setCopiedMustAccept(conflictRide, false)
  const englishConflict = page.waitForResponse(response =>
    response.url().includes(`/api/rides/${conflictRide}/accept`) && response.request().method() === 'POST',
  )
  await conflicted.getByRole('button', { name: 'Accept ride', exact: true }).click()
  expect((await englishConflict).status()).toBe(409)
  await expect(page.getByRole('alert')).toContainText('This ride can no longer be accepted.')
  await expect(accepted.getByRole('button')).toHaveCount(0)
  await expect(conflicted.getByRole('button')).toHaveCount(0)

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  expect(overflow).toBe(false)

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(accepted.getByText('Accepted')).toBeVisible()
})

test('a driver with no linked Driver sees an empty list', async ({ page }) => {
  const tenant = await seedTenant('driver-rides-empty')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Prazan')
  await useTheme(page, 'dark')
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, driver.email, driver.password, tenant.name)
  await expect(page.getByRole('heading', { name: 'Moje vožnje' })).toBeVisible()
  await expect(page.getByText('Nemate nadolazećih vožnji.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Transferi' })).toHaveCount(0)
  await switchLocale(page, 'en')
  await expect(page.getByText('You have no upcoming rides.')).toBeVisible()
})
