import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, switchLocale, useTheme } from './fixtures/ui'

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
    await page.getByRole('button', { name: text.more, exact: true }).click()
  }
  else {
    await page.getByRole('button', { name: text.actions(guest), exact: true }).click()
  }
  await page.getByRole('menuitem', { name: text.correct, exact: true }).click()
  await expect(page.getByRole('button', { name: text.save, exact: true })).toBeVisible()
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
        const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
        const clientId = await createdId(page, '/api/clients', { name: 'Klijent Zastarjelo', kind: 'agency' })
        const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Zastarjelo', kind: 'airport' })
        const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Zastarjelo', kind: 'hotel' })
        const recorded = await page.request.post('/api/transfers', {
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
        await other.getByRole('button', { name: text.save, exact: true }).click()
        // An unassigned Ride sends no work order, so the save has no toast. The form closes.
        await expect(other.getByRole('button', { name: text.save, exact: true })).toBeHidden()

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
        await page.getByRole('button', { name: text.save, exact: true }).click()
        await expect(page.getByRole('button', { name: text.save, exact: true })).toBeHidden()
        // The phone list sits below the filters. The toast is the save that passed.
        await expect(page.getByText(text.saved, { exact: true })).toBeVisible()
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
    const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
    const clientId = await createdId(page, '/api/clients', { name: 'Klijent Bivsi', kind: 'agency' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Bivsi', kind: 'airport' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Bivsi', kind: 'hotel' })
    const recorded = await page.request.post('/api/transfers', {
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
    const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
    const clientId = await createdId(page, '/api/clients', { name: 'Client Stale', kind: 'agency' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Start Stale', kind: 'airport' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'End Stale', kind: 'hotel' })
    const recorded = await page.request.post('/api/transfers', {
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
    await other.getByRole('button', { name: copy.hr.save, exact: true }).click()
    await expect(other.getByRole('button', { name: copy.hr.save, exact: true })).toBeHidden()

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
