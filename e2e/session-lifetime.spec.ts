import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { recordTransfer } from './fixtures/record-transfer'
import { memberPassword, seedMember, seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

/**
 * Office warning, driver banners, idle sign-out, and a revoked session
 * (ADR-0057). The warning tests use the real clock and an older sign-in,
 * so the banner and the server agree. The idle tests install the clock
 * at the real current time: a historical clock would make the sign-in
 * look as if it were in the future.
 */

const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

/** The trigger rewrites expires_at from created_at, so the row stays inside the cap. */
async function ageSignIn(email: string, interval: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('AUTH_DATABASE_URL'), max: 1 })
  try {
    const updated = await pool.query(
      `update auth.session set created_at = now() - $2::interval
       where user_id = (select id from auth."user" where lower(email) = lower($1))`,
      [email, interval],
    )
    if (updated.rowCount !== 1)
      throw new Error('Session age did not match one row.')
  }
  finally {
    await pool.end()
  }
}

async function storedDrafts(page: Page): Promise<string> {
  return page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('transferpro-transfer-draft:'))
    .map(([, value]) => value)
    .join('\n'))
}

async function openTransfer(page: Page) {
  await hydrated(page)
  const dialog = page.getByRole('dialog')
  if (await dialog.isVisible())
    return dialog
  const record = page.getByRole('button', { name: 'Zabilježi transfer', exact: true })
  if (await record.isVisible())
    await record.click()
  else
    await page.getByRole('button', { name: 'Novi transfer', exact: true }).click()
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * Pickup already past, and still on today's operational day.
 * Two hours ago is the previous day when the suite runs just after 05:00.
 */
function pastPickupOnThisOperationalDay(): string {
  const now = new Date()
  const day = operationalDateInTimeZone('Europe/Zagreb', now, 5)
  const start = instantFromWallClock(`${day}T05:00`, 'Europe/Zagreb').getTime()
  const candidate = Math.max(start + 60_000, now.getTime() - 60 * 60 * 1000)
  const pickup = candidate < now.getTime() ? candidate : now.getTime() - 1000
  return new Date(pickup).toISOString()
}

async function assignHoldingRide(page: Page, driverUserId: string): Promise<string> {
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Vozač Sesija',
      kind: 'own',
      phone: '+385911110099',
      memberUserId: driverUserId,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: `ZG${crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`,
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Sesija', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Sesija', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Dolazak Sesija', kind: 'hotel' },
  }))
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: pastPickupOnThisOperationalDay(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: 'Gost Sesija',
      price: 42.5,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const body = await recorded.json() as { ride: { id: string } }
  const assigned = await page.request.post(`/api/rides/${body.ride.id}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()
  return body.ride.id
}

test.describe('@phone', () => {
  test('the office warning appears before the twelve-hour end and does not sign out', async ({ page }) => {
    const tenant = await seedTenant('session-office-warn')
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await ageSignIn(tenant.adminEmail, '11 hours 50 minutes')
    await page.reload()
    const warning = page.getByText('Sesija završava za oko 15 minuta.')
    await expect(warning).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectNoAxeViolations(page)

    await switchTheme(page, 'dark')
    await expect(warning).toBeVisible()
    await expectNoAxeViolations(page)

    await switchLocale(page, 'en')
    await expect(page.getByText('This session ends in about 15 minutes.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Home', exact: true })).toBeVisible()
  })

  test('a driver sees the ending banner, and both banners while a ride holds', async ({ page }) => {
    test.setTimeout(120_000)
    const tenant = await seedTenant('session-driver-banner')
    const driver = await seedMember(tenant.tenantId, 'driver', 'session-driver')
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const rideId = await assignHoldingRide(page, driver.userId)
    await page.context().clearCookies()
    await signIn(page, driver.email, memberPassword, tenant.name)

    await ageSignIn(driver.email, '11 hours 40 minutes')
    await page.reload()
    const held = page.getByText('Vožnja u tijeku drži sesiju otvorenom.')
    await expect(held).toBeVisible()
    await expect(page.getByText('i za vrijeme vožnje')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: tenant.name, exact: true })).toBeVisible()
    await expectNoAxeViolations(page)

    await ageSignIn(driver.email, '15 hours 40 minutes')
    await page.reload()
    const cap = page.getByText('i za vrijeme vožnje')
    await expect(held).toBeVisible()
    await expect(cap).toBeVisible()
    await expectNoAxeViolations(page)
    await switchTheme(page, 'dark')
    await expect(held).toBeVisible()
    await expect(cap).toBeVisible()
    await expectNoAxeViolations(page)

    await switchLocale(page, 'en')
    await expect(page.getByText('A ride in progress is keeping this session open.')).toBeVisible()
    await expect(page.getByText('including during the ride')).toBeVisible()

    const done = await page.request.post(`/api/rides/${rideId}/done`, { data: {} })
    expect(done.ok()).toBeTruthy()
    await page.reload()
    await expect(page.getByLabel('Email').or(page.getByLabel('E-pošta'))).toBeVisible()
    await expect(page.getByText('including during the ride')).toHaveCount(0)
    await expect(page.getByText('i za vrijeme vožnje')).toHaveCount(0)
  })
})

test.describe('@phone', () => {
  test('a driver without a holding ride sees only the thirty-minute banner', async ({ page }) => {
    const tenant = await seedTenant('session-driver-plain')
    const driver = await seedMember(tenant.tenantId, 'driver', 'session-plain')
    await useTheme(page, 'light')
    await signIn(page, driver.email, memberPassword, tenant.name)
    await ageSignIn(driver.email, '11 hours 40 minutes')
    await page.reload()
    const ending = page.getByText('Sesija završava za oko 30 minuta.')
    await expect(ending).toBeVisible()
    await expect(page.getByText('Vožnja u tijeku drži sesiju otvorenom.')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: tenant.name, exact: true })).toBeVisible()
    await expectNoAxeViolations(page)
    await switchTheme(page, 'dark')
    await expect(ending).toBeVisible()
    await expectNoAxeViolations(page)
  })
})

test.describe('@phone', () => {
  test('idle sign-out keeps the draft, and a live refresh is not a person', async ({ page }) => {
    test.setTimeout(120_000)
    const tenant = await seedTenant('session-idle')
    await page.clock.install({ time: new Date() })
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const dialog = await openTransfer(page)
    await dialog.getByLabel('Ime gosta').fill('Ana Sesija')
    await expect.poll(() => storedDrafts(page)).toContain('Ana Sesija')

    // Ten refreshes fire in this jump. The last one must not start a new half hour.
    // Recording a transfer leaves Home, so the open form is the proof they are still in.
    await page.clock.fastForward(10 * 60 * 1000)
    await expect(dialog.getByLabel('Ime gosta')).toHaveValue('Ana Sesija')
    await expect(page.getByLabel('E-pošta')).toHaveCount(0)

    await page.clock.fastForward(25 * 60 * 1000)
    await expect(page.getByLabel('E-pošta')).toBeVisible()
    await expect.poll(() => storedDrafts(page)).toContain('Ana Sesija')
  })

  test('an action in one tab keeps the other tab signed in', async ({ browser }) => {
    test.setTimeout(120_000)
    const tenant = await seedTenant('session-idle-tabs')
    const context = await browser.newContext()
    const start = new Date()
    const pageA = await context.newPage()
    const pageB = await context.newPage()
    await pageA.clock.install({ time: start })
    await pageB.clock.install({ time: start })
    await useTheme(pageA, 'light')
    await useTheme(pageB, 'light')
    await signIn(pageA, tenant.adminEmail, tenant.password, tenant.name)
    await pageB.goto('/')
    await expect(pageB.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()
    await hydrated(pageA)
    await hydrated(pageB)
    await expectNoAxeViolations(pageA)

    await switchTheme(pageA, 'dark')
    await switchTheme(pageB, 'dark')
    await expectNoAxeViolations(pageA)

    // One jump moves both pages: this context shares the fake clock.
    // Twenty minutes with no action is still inside the half hour.
    await pageB.clock.fastForward(20 * 60 * 1000)
    await expect(pageA.getByLabel('E-pošta')).toHaveCount(0)
    await expect(pageB.getByLabel('E-pošta')).toHaveCount(0)

    // A key in tab A only. Tab B does not act.
    const dialog = await openTransfer(pageA)
    await dialog.getByLabel('Ime gosta').fill('idle-draft')
    await expect.poll(() => storedDrafts(pageA)).toContain('idle-draft')

    // Forty minutes since the tabs opened, twenty since the key in A.
    await pageB.clock.fastForward(20 * 60 * 1000)
    await expect(pageA.getByLabel('E-pošta')).toHaveCount(0)
    await expect(pageB.getByLabel('E-pošta')).toHaveCount(0)
    await expect(dialog.getByLabel('Ime gosta')).toHaveValue('idle-draft')

    await pageB.clock.fastForward(15 * 60 * 1000)
    await expect(pageB.getByLabel('E-pošta')).toBeVisible({ timeout: 20_000 })
    await expect(pageA.getByLabel('E-pošta')).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => storedDrafts(pageA)).toContain('idle-draft')
    await context.close()
  })
})

test('a click in a hidden tab does not keep the office session', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('session-hidden')
  await page.clock.install({ time: new Date() })
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await hydrated(page)
  await page.clock.fastForward(20 * 60 * 1000)
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
  })
  await page.keyboard.press('a')
  await page.mouse.click(20, 20)
  await page.clock.fastForward(10 * 60 * 1000 + 5_000)
  await expect(page.getByLabel('E-pošta')).toBeVisible()
})

test.describe('@phone', () => {
  test('a password change on another device keeps the transfer draft', async ({ browser }) => {
    const tenant = await seedTenant('session-revoke')
    const first = await browser.newContext()
    const page = await first.newPage()
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const dialog = await openTransfer(page)
    await dialog.getByLabel('Ime gosta').fill('Ana Ostaje')
    await expect.poll(() => storedDrafts(page)).toContain('Ana Ostaje')

    const second = await browser.newContext()
    const other = await second.newPage()
    await signIn(other, tenant.adminEmail, tenant.password, tenant.name)
    await other.goto('/profile')
    await hydrated(other)
    const next = 'e2e-changed-session1'
    await other.getByLabel('Trenutna lozinka', { exact: true }).fill(tenant.password)
    await other.getByLabel('Nova lozinka', { exact: true }).fill(next)
    await other.getByLabel('Potvrda lozinke', { exact: true }).fill(next)
    await other.getByRole('button', { name: 'Spremi lozinku', exact: true }).click()
    await expect(other.getByText('Lozinka je promijenjena', { exact: true })).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('E-pošta')).toBeVisible()
    await expect.poll(() => storedDrafts(page)).toContain('Ana Ostaje')
    await first.close()
    await second.close()
  })
})
