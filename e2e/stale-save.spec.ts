import type { Browser, Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, operationalNow, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, switchLocale, useTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // One instant for the seed and the board, including across 05:00.
  await pinOperationalClock(page)
})

/**
 * A refused office save names who changed the Transfer and when, then
 * Osvježi loads that change into the form (issue #334).
 */

const copy = {
  hr: {
    actions: (guest: string) => `Radnje: ${guest}`,
    correct: 'Ispravi transfer',
    more: 'Više',
    guest: 'Ime gosta',
    save: 'Spremi ispravak',
    changed: 'Vožnja je promijenjena',
    refresh: 'Osvježi',
    saved: 'Ispravljeno.',
    former: 'Bivši član',
    by: (name: string, time: string) => `Promijenio ${name} u ${time}`,
  },
  en: {
    actions: (guest: string) => `Actions: ${guest}`,
    correct: 'Correct transfer',
    more: 'More',
    guest: 'Guest name',
    save: 'Save correction',
    changed: 'The ride has changed',
    refresh: 'Refresh',
    saved: 'Corrected.',
    former: 'Former member',
    by: (name: string, time: string) => `${name} changed it at ${time}`,
  },
} as const

type Locale = keyof typeof copy

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function openCorrection(page: Page, guest: string, locale: Locale) {
  const text = copy[locale]
  await page.goto('/transfers')
  if (isPhone(page)) {
    await page.getByRole('listitem').filter({ hasText: guest }).click()
    // The shell bar is also named Više until this detail is open. The pinned
    // clock can leave that bar up for the next click, so wait and stay inside.
    const detail = page.getByRole('dialog', { name: guest, exact: true })
    await expect(detail).toBeVisible()
    await detail.getByRole('button', { name: text.more, exact: true }).click()
  }
  else {
    await page.getByRole('button', { name: text.actions(guest), exact: true }).click()
  }
  await page.getByRole('menuitem', { name: text.correct, exact: true }).click()
  await expect(page.getByRole('button', { name: text.save, exact: true })).toBeVisible()
}

async function saveAndClose(page: Page, locale: Locale) {
  const text = copy[locale]
  const saved = page.waitForResponse(response =>
    response.request().method() === 'PATCH'
    && response.url().includes('/api/transfers/')
    && response.ok(),
  )
  await page.getByRole('button', { name: text.save, exact: true }).click()
  await saved
  await expect(page.getByText(text.saved, { exact: true })).toBeVisible()
}

async function secondPage(browser: Browser, page: Page, theme: 'light' | 'dark') {
  const baseURL = test.info().project.use.baseURL
  if (baseURL === undefined)
    throw new Error('Playwright baseURL is required.')
  const context = await browser.newContext({
    baseURL,
    locale: 'hr-HR',
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    colorScheme: theme,
  })
  const other = await context.newPage()
  // The colleague's board must open on the same operational day as the seed.
  await pinOperationalClock(other, operationalNow(page))
  await useTheme(other, theme)
  return { context, other }
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`a refused correction names who changed it, and Osvježi loads that change, in ${theme}`, async ({ browser, page }) => {
      test.setTimeout(120_000)
      const text = copy.hr
      const typed = 'Drugi gost'
      const savedGuest = 'Spremljeni gost'
      const tenant = await seedTenant(`stale-${theme}`)
      const colleague = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const { context, other } = await secondPage(browser, page, theme)
      try {
        const day = operationalDay(page)
        const clientId = await createdId(page, '/api/clients', { name: 'Klijent Zastarjelo', kind: 'agency' })
        const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Zastarjelo', kind: 'airport' })
        const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Zastarjelo', kind: 'hotel' })
        const recorded = await recordTransfer(page.request, {
          data: {
            clientId,
            pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
            startLocationId,
            endLocationId,
            passengerCount: 1,
            guestName: 'Ana Zastarjelo',
            price: 42.5,
            payment: 'cash',
            airportMark: false,
            luggageCount: 0,
            childSeatCount: 0,
          },
        })
        expect(recorded.ok()).toBeTruthy()

        await signIn(other, colleague.email, colleague.password, tenant.name)
        await openCorrection(page, 'Ana Zastarjelo', 'hr')
        await openCorrection(other, 'Ana Zastarjelo', 'hr')
        await page.getByLabel(text.guest).fill(typed)
        await other.getByLabel(text.guest).fill(savedGuest)
        await saveAndClose(other, 'hr')

        const listed = await page.request.get('/api/transfers', { params: { date: day } })
        expect(listed.ok()).toBeTruthy()
        const rides = (await listed.json() as { rides: { changedAt: string | null, changedByName: string | null }[] }).rides
        const changedAt = rides[0]?.changedAt
        expect(changedAt).toEqual(expect.any(String))
        const when = formatInstant(new Date(changedAt!), 'Europe/Zagreb', 'hr')

        await page.getByRole('button', { name: text.save, exact: true }).click()
        const alert = page.getByRole('alert').filter({ hasText: text.by(colleague.name, when) })
        await expect(alert).toBeVisible()
        await expect(alert).toBeFocused()
        await expect(page.getByText(text.changed)).toBeVisible()
        await expect(page.getByLabel(text.guest)).toHaveValue(typed)
        await expectNoAxeViolations(page)

        await alert.getByRole('button', { name: text.refresh, exact: true }).click()
        await expect(page.getByLabel(text.guest)).toHaveValue(savedGuest)
        await saveAndClose(page, 'hr')
      }
      finally {
        await context.close()
      }
    })
  }
})

test('a member who left is named as a former member', async ({ browser, page }) => {
  test.setTimeout(120_000)
  const text = copy.hr
  const typed = 'Drugi gost'
  const savedGuest = 'Spremljeni gost'
  const tenant = await seedTenant('stale-former')
  const colleague = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const { context, other } = await secondPage(browser, page, 'light')
  try {
    const day = operationalDay(page)
    const clientId = await createdId(page, '/api/clients', { name: 'Klijent Bivsi', kind: 'agency' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Bivsi', kind: 'airport' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Bivsi', kind: 'hotel' })
    const recorded = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: 'Ana Bivsi',
        price: 10,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    expect(recorded.ok()).toBeTruthy()
    const transferId = (await recorded.json() as { transfer: { id: string } }).transfer.id

    await signIn(other, colleague.email, colleague.password, tenant.name)
    await openCorrection(page, 'Ana Bivsi', 'hr')
    await page.getByLabel(text.guest).fill(typed)
    const patched = await other.request.patch(`/api/transfers/${transferId}`, {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: savedGuest,
        price: 10,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
        version: 0,
      },
    })
    expect(patched.ok()).toBeTruthy()
    expect((await page.request.delete(`/api/members/${colleague.userId}`)).ok()).toBeTruthy()

    const listed = await page.request.get('/api/transfers', { params: { date: day } })
    const rides = (await listed.json() as { rides: { changedAt: string | null, changedByName: string | null }[] }).rides
    expect(rides[0]?.changedByName).toBeNull()
    const when = formatInstant(new Date(rides[0]!.changedAt!), 'Europe/Zagreb', 'hr')

    await page.getByRole('button', { name: text.save, exact: true }).click()
    const alert = page.getByRole('alert').filter({ hasText: text.by(text.former, when) })
    await expect(alert).toBeVisible()
    await expect(page.getByLabel(text.guest)).toHaveValue(typed)
    await alert.getByRole('button', { name: text.refresh, exact: true }).click()
    await expect(page.getByLabel(text.guest)).toHaveValue(savedGuest)
  }
  finally {
    await context.close()
  }
})

test('the refusal is in English', async ({ browser, page }) => {
  test.setTimeout(120_000)
  const text = copy.en
  const tenant = await seedTenant('stale-en')
  const colleague = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await switchLocale(page, 'en')
  const { context, other } = await secondPage(browser, page, 'light')
  try {
    const day = operationalDay(page)
    const clientId = await createdId(page, '/api/clients', { name: 'Client Stale', kind: 'agency' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Start Stale', kind: 'airport' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'End Stale', kind: 'hotel' })
    const recorded = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: 'Ana Stale',
        price: 10,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    expect(recorded.ok()).toBeTruthy()

    await signIn(other, colleague.email, colleague.password, tenant.name)
    await openCorrection(page, 'Ana Stale', 'en')
    await openCorrection(other, 'Ana Stale', 'hr')
    await page.getByLabel(text.guest).fill('Second guest')
    await other.getByLabel(copy.hr.guest).fill('Saved guest')
    await saveAndClose(other, 'hr')

    const listed = await page.request.get('/api/transfers', { params: { date: day } })
    const rides = (await listed.json() as { rides: { changedAt: string | null }[] }).rides
    const when = formatInstant(new Date(rides[0]!.changedAt!), 'Europe/Zagreb', 'en')

    await page.getByRole('button', { name: text.save, exact: true }).click()
    const alert = page.getByRole('alert').filter({ hasText: text.by(colleague.name, when) })
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('button', { name: text.refresh, exact: true })).toBeVisible()
    await expect(page.getByLabel(text.guest)).toHaveValue('Second guest')
    await expect(page.getByText(text.changed)).toBeVisible()
  }
  finally {
    await context.close()
  }
})

test('a refused clear names who removed the assignment, and Osvježi closes the dialog', async ({ browser, page }) => {
  test.setTimeout(120_000)
  const text = copy.hr
  const guest = 'Ana Dodjela'
  const tenant = await seedTenant('stale-clear')
  const colleague = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const { context, other } = await secondPage(browser, page, 'light')
  try {
    const day = operationalDay(page)
    const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)
    const clientId = await createdId(page, '/api/clients', { name: 'Klijent Dodjela', kind: 'agency' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Dodjela', kind: 'airport' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Dodjela', kind: 'hotel' })
    const driverId = await createdId(page, '/api/drivers', {
      name: 'Vozač Dodjela',
      kind: 'own',
      phone: '+385911112244',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    })
    const vehicleId = await createdId(page, '/api/vehicles', {
      registrationPlate: 'DU334AA',
      kind: 'fixed',
      seatCount: 4,
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    })
    const recorded = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: guest,
        price: 10,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    expect(recorded.ok()).toBeTruthy()
    const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
    const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { version: 0, driverId, vehicleId },
    })
    expect(assigned.ok()).toBeTruthy()

    await signIn(other, colleague.email, colleague.password, tenant.name)
    await page.goto('/transfers')
    await page.getByRole('button', { name: text.actions(guest), exact: true }).click()
    await page.getByRole('menuitem', { name: 'Ukloni dodjelu', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Uklanjanje dodjele' })
    await expect(dialog).toBeVisible()

    const opened = await page.request.get('/api/transfers', { params: { date: day } })
    const openedRide = (await opened.json() as { rides: { version: number }[] }).rides[0]
    const cleared = await other.request.post(`/api/rides/${rideId}/clear`, {
      data: { version: openedRide?.version },
    })
    expect(cleared.ok()).toBeTruthy()

    const listed = await page.request.get('/api/transfers', { params: { date: day } })
    const rides = (await listed.json() as { rides: { changedAt: string | null, changedByName: string | null }[] }).rides
    expect(rides[0]?.changedByName).toBe(colleague.name)
    const when = formatInstant(new Date(rides[0]!.changedAt!), 'Europe/Zagreb', 'hr')

    await dialog.getByRole('button', { name: 'Ukloni dodjelu', exact: true }).click()
    const alert = dialog.getByRole('alert').filter({ hasText: text.by(colleague.name, when) })
    await expect(alert).toBeVisible()
    await expect(dialog).toContainText(guest)

    await alert.getByRole('button', { name: text.refresh, exact: true }).click()
    await expect(dialog).toBeHidden()
    const row = page.getByRole('row', { name: guest })
    await expect(row.getByRole('cell', { name: /^Nedodijeljeno/ })).toBeVisible()
    await expect(row.getByRole('button', { name: `Dodijeli: ${guest}`, exact: true })).toBeVisible()
  }
  finally {
    await context.close()
  }
})
