import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, switchTheme } from './fixtures/ui'

/**
 * Maps on the Ride detail (issue #452, ADR-0052).
 * The phone project runs the @phone block. The desktop project runs it too,
 * so that block sets a phone viewport itself.
 */

const startRef = 'ChIJrideStart'
const endRef = 'ChIJrideEnd'
const replacedRef = 'ChIJrideReplaced'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

async function createdLocation(page: Page, data: unknown): Promise<string> {
  const response = await page.request.post('/api/locations', { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function createdClient(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/clients', { data: { name, kind: 'agency' } })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function recordRide(page: Page, input: {
  clientId: string
  startLocationId: string
  endLocationId: string
  guestName: string
  pickupAt: string
}): Promise<{ transferId: string }> {
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId: input.clientId,
      startLocationId: input.startLocationId,
      endLocationId: input.endLocationId,
      passengerCount: 1,
      price: 20,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
      guestName: input.guestName,
      pickupAt: input.pickupAt,
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const body = await recorded.json() as { transfer: { id: string } }
  return { transferId: body.transfer.id }
}

/**
 * The record route refuses the same Location. The row is stored with two
 * Locations, then the end is set to the start, which is the case the detail
 * must not show twice (ADR-0052).
 */
async function storeSameLocation(transferId: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    const updated = await pool.query(
      `update app.transfers set end_location_id = start_location_id where id = $1`,
      [transferId],
    )
    if (updated.rowCount !== 1)
      throw new Error('The ride was not made a same-place ride.')
  }
  finally {
    await pool.end()
  }
}

function mapButtons(detail: Locator) {
  return detail.getByRole('button', { name: /^(Prikaži na karti|Sakrij kartu|Show on map|Hide map)$/ })
}

/**
 * The frame is the detail's width and 240px high. The fake src carries the
 * reference and the language, and not the address, the name, or a key.
 */
async function expectMapFrame(detail: Locator, name: string, language: 'hr' | 'en', placeRef: string) {
  const title = language === 'hr' ? `Karta: ${name}` : `Map: ${name}`
  const frame = detail.getByTitle(title)
  await expect(frame).toBeVisible()
  const src = await frame.getAttribute('src')
  expect(src).toContain('about:blank#')
  expect(src).toContain(`placeRef=${placeRef}`)
  expect(src).toContain(`language=${language}`)
  expect(src).not.toContain(name)
  expect(src).not.toContain('key=')
  expect(src).not.toContain('google.com')
  const params = new URLSearchParams((src ?? '').split('#')[1] ?? '')
  expect([...params.keys()].sort()).toEqual(['language', 'placeRef'])
  await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  await expect(frame).toHaveAttribute('allow', '')
  expect(await frame.getAttribute('sandbox')).toBeNull()
  await expect(frame).toHaveCSS('height', '240px')
  const frameBox = await frame.boundingBox()
  const factsBox = await detail.locator('dl').boundingBox()
  expect(frameBox).not.toBeNull()
  expect(factsBox).not.toBeNull()
  expect(Math.abs((frameBox?.width ?? 0) - (factsBox?.width ?? 0))).toBeLessThanOrEqual(2)
  return frame
}

async function openRide(page: Page, guest: string) {
  const phone = (page.viewportSize()?.width ?? 1280) < 1024
  if (phone)
    await page.getByRole('listitem').filter({ hasText: guest }).locator('time').click()
  else
    await page.getByRole('row', { name: guest }).click()
  const detail = page.locator('#ride-detail')
  await expect(detail.getByRole('heading', { name: guest })).toBeVisible()
  return detail
}

function nextLocations(page: Page) {
  return page.waitForResponse(response =>
    response.request().method() === 'GET'
    && new URL(response.url()).pathname === '/api/locations'
    && response.ok(),
  )
}

test('the ride detail shows both maps on a desktop, in both languages and both themes', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('ride-maps')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const clientId = await createdClient(page, 'Klijent Karta')
  const startLocationId = await createdLocation(page, {
    name: 'Polazak Karta',
    kind: 'airport',
    iata: 'DBV',
    address: 'Čilipi 1',
    place: { provider: 'google', placeRef: startRef },
  })
  const endLocationId = await createdLocation(page, {
    name: 'Dolazak Karta',
    kind: 'hotel',
    address: 'Put 8',
    place: { provider: 'google', placeRef: endRef },
  })
  const typedEndId = await createdLocation(page, {
    name: 'Dolazak Tipkano',
    kind: 'address',
    address: 'Ulica 3',
  })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  await recordRide(page, {
    clientId,
    startLocationId,
    endLocationId,
    guestName: 'Iva Karta',
    pickupAt: instantFromWallClock(`${day}T10:00`, 'Europe/Zagreb').toISOString(),
  })
  await recordRide(page, {
    clientId,
    startLocationId,
    endLocationId: typedEndId,
    guestName: 'Iva Tipkano',
    pickupAt: instantFromWallClock(`${day}T11:00`, 'Europe/Zagreb').toISOString(),
  })

  const google: string[] = []
  const onRequest = (request: { url: () => string }) => {
    const host = new URL(request.url()).hostname
    if (host.includes('google') || host.includes('gstatic'))
      google.push(request.url())
  }
  page.on('request', onRequest)
  try {
    const loaded = await page.goto(`/transfers?day=${day}`)
    expect((loaded?.headers()['referrer-policy'] ?? '').toLowerCase()).not.toBe('no-referrer')
    await hydrated(page)

    const detail = await openRide(page, 'Iva Karta')
    const buttons = mapButtons(detail)
    await expect(buttons).toHaveCount(2)
    await expect(detail.locator('iframe')).toHaveCount(0)
    await expect(page.locator('#transfer-day-list').getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await expectNoAxeViolations(page)

    const start = buttons.nth(0)
    const end = buttons.nth(1)
    await expect(start).toHaveAttribute('aria-expanded', 'false')
    await start.click()
    await expect(start).toBeFocused()
    await expect(start).toHaveAccessibleName('Sakrij kartu')
    await expect(start).toHaveAttribute('aria-expanded', 'true')
    const startFrame = await expectMapFrame(detail, 'Polazak Karta', 'hr', startRef)
    await expect(startFrame).toHaveAttribute('id', (await start.getAttribute('aria-controls')) ?? '')
    await end.click()
    await expect(end).toBeFocused()
    await expect(detail.locator('iframe')).toHaveCount(2)
    const endFrame = await expectMapFrame(detail, 'Dolazak Karta', 'hr', endRef)
    expect(await start.getAttribute('aria-controls')).not.toBe(await end.getAttribute('aria-controls'))
    await expect(endFrame).toHaveAttribute('id', (await end.getAttribute('aria-controls')) ?? '')
    await expectNoAxeViolations(page)

    // Assign covers the facts. The open frame stays, so cancel does not load it again.
    await startFrame.evaluate(element => element.setAttribute('data-kept', '1'))
    await detail.getByRole('button', { name: 'Dodijeli', exact: true }).click()
    await expect(detail.getByRole('button', { name: 'Odustani', exact: true })).toBeVisible()
    await expect(startFrame).toHaveAttribute('data-kept', '1')
    await detail.getByRole('button', { name: 'Odustani', exact: true }).click()
    await expect(startFrame).toBeVisible()
    await expect(startFrame).toHaveAttribute('data-kept', '1')

    await openRide(page, 'Iva Tipkano')
    await expect(detail.locator('iframe')).toHaveCount(0)
    await expect(mapButtons(detail)).toHaveCount(1)
    await expect(mapButtons(detail)).toHaveAccessibleName('Prikaži na karti')

    await openRide(page, 'Iva Karta')
    await switchLocale(page, 'en')
    const english = await openRide(page, 'Iva Karta')
    const showEn = mapButtons(english)
    await expect(showEn).toHaveCount(2)
    await expect(english.locator('iframe')).toHaveCount(0)
    await expectNoAxeViolations(page)
    await showEn.nth(0).click()
    await showEn.nth(1).click()
    await expectMapFrame(english, 'Polazak Karta', 'en', startRef)
    await expectMapFrame(english, 'Dolazak Karta', 'en', endRef)
    await expectNoAxeViolations(page)

    await switchTheme(page, 'dark')
    await expect(page.locator('html')).toHaveClass(/dark/)
    const dark = await openRide(page, 'Iva Karta')
    await expect(dark.locator('iframe')).toHaveCount(0)
    await expectNoAxeViolations(page)
    await mapButtons(dark).nth(0).click()
    await mapButtons(dark).nth(1).click()
    await expectMapFrame(dark, 'Polazak Karta', 'en', startRef)
    await expectMapFrame(dark, 'Dolazak Karta', 'en', endRef)
    await expectNoAxeViolations(page)

    await switchLocale(page, 'hr')
    await expect(page.locator('html')).toHaveClass(/dark/)
    const darkHr = await openRide(page, 'Iva Karta')
    await expect(darkHr.locator('iframe')).toHaveCount(0)
    await expectNoAxeViolations(page)
    await mapButtons(darkHr).nth(0).click()
    await mapButtons(darkHr).nth(1).click()
    await expectMapFrame(darkHr, 'Polazak Karta', 'hr', startRef)
    await expectMapFrame(darkHr, 'Dolazak Karta', 'hr', endRef)
    await expectNoAxeViolations(page)

    await switchTheme(page, 'light')
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    const light = await openRide(page, 'Iva Karta')
    await mapButtons(light).nth(0).click()
    await expectMapFrame(light, 'Polazak Karta', 'hr', startRef)
    expect(google).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
})

test('a live refresh keeps an unchanged map and closes a cleared reference', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('ride-maps-refresh')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const clientId = await createdClient(page, 'Klijent Osvježi')
  const startLocationId = await createdLocation(page, {
    name: 'Polazak Osvježi',
    kind: 'hotel',
    address: 'Put 2',
    place: { provider: 'google', placeRef: startRef },
  })
  const endLocationId = await createdLocation(page, {
    name: 'Dolazak Osvježi',
    kind: 'hotel',
    address: 'Put 4',
    place: { provider: 'google', placeRef: endRef },
  })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  await recordRide(page, {
    clientId,
    startLocationId,
    endLocationId,
    guestName: 'Iva Osvježi',
    pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
  })
  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  const detail = await openRide(page, 'Iva Osvježi')
  await mapButtons(detail).nth(0).click()
  const frame = detail.locator('iframe')
  await expect(frame).toHaveCount(1)
  await frame.evaluate(element => element.setAttribute('data-kept', '1'))
  const src = await frame.getAttribute('src')

  const unchanged = nextLocations(page)
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await unchanged
  await expect(frame).toHaveAttribute('data-kept', '1')
  await expect(frame).toHaveAttribute('src', src ?? '')

  expect((await page.request.patch(`/api/locations/${startLocationId}`, {
    data: { place: { provider: 'google', placeRef: replacedRef } },
  })).ok()).toBeTruthy()
  const replaced = nextLocations(page)
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await replaced
  await expect(frame).toHaveAttribute('data-kept', '1')
  await expect(frame).toHaveAttribute('src', new RegExp(`placeRef=${replacedRef}`))

  expect((await page.request.patch(`/api/locations/${startLocationId}`, {
    data: { place: null },
  })).ok()).toBeTruthy()
  const cleared = nextLocations(page)
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await cleared
  await expect(detail.locator('iframe')).toHaveCount(0)
  await expect(mapButtons(detail)).toHaveCount(1)
  await expect(mapButtons(detail)).toHaveAccessibleName('Prikaži na karti')
})

test('a same-place ride has one map button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('ride-maps-same')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const clientId = await createdClient(page, 'Klijent Isto')
  const startLocationId = await createdLocation(page, {
    name: 'Polazak Isto',
    kind: 'hotel',
    address: 'Put 6',
    place: { provider: 'google', placeRef: startRef },
  })
  const endLocationId = await createdLocation(page, {
    name: 'Dolazak Isto',
    kind: 'address',
    address: 'Put 7',
    place: { provider: 'google', placeRef: endRef },
  })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await recordRide(page, {
    clientId,
    startLocationId,
    endLocationId,
    guestName: 'Iva Isto',
    pickupAt: instantFromWallClock(`${day}T13:00`, 'Europe/Zagreb').toISOString(),
  })
  await storeSameLocation(recorded.transferId)
  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  const detail = await openRide(page, 'Iva Isto')
  await expect(detail.getByText('Polazak Isto', { exact: true })).toHaveCount(2)
  await expect(mapButtons(detail)).toHaveCount(1)
  await mapButtons(detail).click()
  await expectMapFrame(detail, 'Polazak Isto', 'hr', startRef)
  await expect(detail.locator('iframe')).toHaveCount(1)
})

test.describe('@phone', () => {
  for (const { theme, locale } of [
    { theme: 'light', locale: 'hr' },
    { theme: 'dark', locale: 'en' },
  ] as const) {
    test(`the ride maps open one at a time in ${theme} and ${locale} and pass axe`, async ({ page }) => {
      test.setTimeout(120_000)
      await page.setViewportSize({ width: 390, height: 844 })
      const tenant = await seedTenant(`ride-maps-phone-${theme}`)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await switchTheme(page, theme)
      const clientId = await createdClient(page, 'Klijent Telefon')
      const startLocationId = await createdLocation(page, {
        name: 'Polazak Telefon',
        kind: 'airport',
        iata: 'SPU',
        address: 'Kaštel 1',
        place: { provider: 'google', placeRef: startRef },
      })
      const endLocationId = await createdLocation(page, {
        name: 'Dolazak Telefon',
        kind: 'hotel',
        address: 'Put 9',
        place: { provider: 'google', placeRef: endRef },
      })
      const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
      await recordRide(page, {
        clientId,
        startLocationId,
        endLocationId,
        guestName: 'Iva Telefon',
        pickupAt: instantFromWallClock(`${day}T14:00`, 'Europe/Zagreb').toISOString(),
      })
      await page.goto(`/transfers?day=${day}`)
      await hydrated(page)
      if (locale === 'en')
        await switchLocale(page, 'en')

      const detail = await openRide(page, 'Iva Telefon')
      const showName = locale === 'en' ? 'Show on map' : 'Prikaži na karti'
      const hideName = locale === 'en' ? 'Hide map' : 'Sakrij kartu'
      const buttons = mapButtons(detail)
      await expect(buttons).toHaveCount(2)
      await expect(detail.locator('iframe')).toHaveCount(0)
      const height = (await buttons.nth(0).boundingBox())?.height ?? 0
      expect(height).toBeGreaterThanOrEqual(44)
      await expectNoAxeViolations(page)

      await buttons.nth(0).click()
      await expect(buttons.nth(0)).toBeFocused()
      await expect(buttons.nth(0)).toHaveAccessibleName(hideName)
      await expectMapFrame(detail, 'Polazak Telefon', locale, startRef)
      await expect(detail.locator('iframe')).toHaveCount(1)
      await expectNoAxeViolations(page)

      await buttons.nth(1).click()
      await expect(buttons.nth(1)).toHaveAccessibleName(hideName)
      await expect(buttons.nth(0)).toHaveAccessibleName(showName)
      await expect(detail.locator('iframe')).toHaveCount(1)
      await expectMapFrame(detail, 'Dolazak Telefon', locale, endRef)
      await expectNoAxeViolations(page)
    })
  }
})
