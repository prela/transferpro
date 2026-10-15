import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Transfers day table (issue #254). The phone project runs the @phone
 * block as well; the desktop project runs everything.
 */

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function places(page: Page) {
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Dan', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Dan', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Dan', kind: 'hotel' })
  return { clientId, startLocationId, endLocationId }
}

async function record(page: Page, guest: string, day: string, wall: string, spot: {
  clientId: string
  startLocationId: string
  endLocationId: string
}) {
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId: spot.clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
      startLocationId: spot.startLocationId,
      endLocationId: spot.endLocationId,
      passengerCount: 2,
      guestName: guest,
      flightNumber: 'OU384',
      price: 42.5,
      payment: 'cash',
      airportMark: true,
      luggageCount: 1,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
}

test('the day field id is the same in the server document and after hydration', async ({ page }) => {
  const tenant = await seedTenant('transfers-day-id')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const response = await page.goto('/transfers')
  const html = await response?.text()
  expect(html).toContain('for="transfer-day"')
  expect(html).toContain('id="transfer-day"')
  await hydrated(page)
  await expect(page.locator('label[for="transfer-day"]')).toBeVisible()
  await expect(page.locator('#transfer-day')).toHaveAttribute('id', 'transfer-day')
})

test('reloading the URL restores the day and the filter', async ({ page }) => {
  const tenant = await seedTenant('transfers-url')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/transfers')
  await hydrated(page)
  const today = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const next = addCalendarDays(today, 1)
  await page.locator('#transfer-day').fill(next)
  await expect(page).toHaveURL(new RegExp(`day=${next}`))
  await page.getByRole('button', { name: /^Hitno \(/ }).click()
  await expect(page).toHaveURL(/filter=urgent/)
  await page.reload()
  await expect(page.locator('#transfer-day')).toHaveValue(next)
  await expect(page.getByRole('button', { name: /^Hitno \(/ })).toHaveAttribute('aria-pressed', 'true')
})

test('desktop columns fit 1366 and a row stays compact', async ({ page }) => {
  const tenant = await seedTenant('transfers-columns')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const spot = await places(page)
  const day = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 1)
  await record(page, 'Ana Stupac', day, '12:00', spot)
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto(`/transfers?day=${day}`)
  for (const name of ['Vrijeme', 'Let', 'Gost', 'Relacija', 'Naručitelj', 'Vozač · vozilo', 'Stanje', 'Cijena'])
    await expect(page.getByRole('columnheader', { name })).toBeVisible()
  const row = page.getByRole('row', { name: 'Ana Stupac' })
  await expect(row).toBeVisible()
  await expect(row).toContainText('OU384')
  await expect(row).toContainText('Nedodijeljeno')
  const box = await row.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(36)
  expect(box?.height ?? 0).toBeLessThanOrEqual(48)
  const assign = row.getByRole('button', { name: 'Dodijeli: Ana Stupac' })
  const control = await assign.boundingBox()
  expect(control?.height ?? 0).toBeGreaterThanOrEqual(28)
  expect(control?.height ?? 0).toBeLessThanOrEqual(32)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('a refresh keeps the filter and does not empty the list', async ({ page }) => {
  const tenant = await seedTenant('transfers-refresh')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const spot = await places(page)
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  await record(page, 'Mia Ostaje', day, '16:00', spot)
  await page.goto('/transfers')
  const row = page.getByRole('row', { name: 'Mia Ostaje' })
  await expect(row).toBeVisible()
  // The day read is cache: no-store, and Chromium still answers a repeat GET
  // without a network hop that page.route can abort. Fail the next fetch here.
  await page.evaluate(() => {
    const orig = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/transfers'))
        throw new TypeError('network')
      return orig(input, init)
    }
  })
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await expect(page.getByText(/Nije osvježeno, zadnje u \d{2}:\d{2}/)).toBeVisible()
  await expect(row).toBeVisible()
  await expect(page.getByText('Dnevni popis nije se mogao učitati. Pokušajte ponovno.')).toHaveCount(0)
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the transfers day follows ${theme} and passes axe`, async ({ page }) => {
      const tenant = await seedTenant(`transfers-phone-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const phone = (page.viewportSize()?.width ?? 1280) < 1024
      if (!phone)
        await page.setViewportSize({ width: 1366, height: 768 })
      await page.goto('/transfers')
      await expect(page.getByRole('button', { name: 'Danas', exact: true })).toBeVisible()
      if (phone) {
        await expect(page.getByRole('columnheader', { name: 'Vrijeme' })).toHaveCount(0)
        const spot = await places(page)
        const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
        await record(page, 'Iva Telefon', day, '15:00', spot)
        await page.reload()
        const card = page.getByRole('listitem').filter({ hasText: 'Iva Telefon' })
        await expect(card).toBeVisible()
        await expect(card).toContainText('Polazak Dan')
        await expect(card).toContainText('Dolazak Dan')
        const action = card.getByRole('button', { name: 'Dodijeli: Iva Telefon' })
        const box = await action.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
        expect(box?.height ?? 0).toBeLessThanOrEqual(48)
      }
      else {
        await expect(page.getByText('Nema vožnji ovaj dan.')).toBeVisible()
      }
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})
