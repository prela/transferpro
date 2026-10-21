import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Hand a Ride to a Partner from the detail (issue #410).
 * The phone project runs this block. The desktop project runs it too.
 */

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

async function recordTodayRide(page: Page, guest: string): Promise<{ rideId: string, day: string }> {
  const clientId = await createdId(page, '/api/clients', { name: `Klijent ${guest}`, kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: `Polazak ${guest}`, kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: `Dolazak ${guest}`, kind: 'hotel' })
  const day = operationalDay(page)
  const pickupAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt,
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      price: 42.5,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const body = await recorded.json() as { ride: { id: string } }
  return { rideId: body.ride.id, day }
}

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

function rideRow(page: Page, guest: string) {
  if (isPhone(page))
    return page.getByRole('listitem').filter({ hasText: guest })
  return page.getByRole('row', { name: guest })
}

async function openRide(page: Page, day: string, rideId: string, guest: string) {
  await page.goto(`/transfers?day=${day}&ride=${rideId}`)
  await hydrated(page)
  await expect(page.locator('#ride-detail').getByRole('heading', { name: guest })).toBeVisible()
}

async function pickPartner(page: Page, name: string) {
  const detail = page.locator('#ride-detail')
  if (isPhone(page)) {
    await detail.getByRole('button', { name, exact: true }).click()
    return
  }
  await chooseOption(page, detail.getByRole('combobox', { name: 'Podizvođač' }), name)
}

async function handOff(page: Page, partner: string) {
  const detail = page.locator('#ride-detail')
  await detail.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true }).click()
  await expect(detail.getByRole('heading', { name: 'Predaj podizvođaču' })).toBeVisible()
  await pickPartner(page, partner)
  await detail.getByRole('button', { name: 'Predaj vožnju', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Predano podizvođaču' })).toBeVisible()
}

async function balanceAddsUp(page: Page, guest: string) {
  await page.goto('/')
  await hydrated(page)
  const counts = page.getByRole('region', { name: 'Brojevi za operativni dan' })
  await expect(counts).toBeVisible()
  const parts = [
    'Nedodijeljeno',
    'Čeka prihvat',
    'Dodijeljeno, nije krenulo',
    'U tijeku',
    'Predano podizvođaču',
    'Obavljeno',
    'Nedolazak',
    'Otkazano',
  ]
  const rides = await countValue(counts, 'Vožnje')
  let sum = 0
  for (const label of parts)
    sum += await countValue(counts, label)
  expect(sum).toBe(rides)
  expect(await countValue(counts, 'Predano podizvođaču')).toBe(1)
  await counts.getByRole('link', { name: /^Predano podizvođaču \d+$/ }).click()
  await expect(page).toHaveURL(/filter=handedOff/)
  await expect(rideRow(page, guest)).toContainText(guest)
}

async function countValue(region: ReturnType<Page['getByRole']>, label: string): Promise<number> {
  const link = region.getByRole('link', { name: new RegExp(`^${label} \\d+$`) })
  const text = await link.getAttribute('aria-label')
  const match = text?.match(/(\d+)$/)
  return Number(match?.[1] ?? 'NaN')
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`hands a ride to a partner, changes it, takes it back, and closes it in ${theme}`, async ({ page }) => {
      test.setTimeout(180_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`handoff-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const guest = 'Iva Predaja'
      const first = 'Mora Transfer'
      const second = 'Jadran Prijevoz'
      await createdId(page, '/api/partners', { name: first })
      await createdId(page, '/api/partners', { name: second })
      const { rideId, day } = await recordTodayRide(page, guest)

      await openRide(page, day, rideId, guest)
      const detail = page.locator('#ride-detail')
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true }).click()
      await expect(detail.getByRole('heading', { name: 'Predaj podizvođaču' })).toBeVisible()
      await expectNoAxeViolations(page)
      await pickPartner(page, first)
      await detail.getByRole('button', { name: 'Predaj vožnju', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Predano podizvođaču' })).toBeVisible()
      await expect(rideRow(page, guest)).toContainText(first)
      await expect(rideRow(page, guest)).toContainText('Predano podizvođaču')

      await balanceAddsUp(page, guest)

      await openRide(page, day, rideId, guest)
      await expect(detail.getByText(first)).toBeVisible()
      await expect(detail.getByText('Nedodijeljeno')).toHaveCount(0)
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Promijeni podizvođača', exact: true }).click()
      await expect(detail.getByRole('heading', { name: 'Promjena podizvođača' })).toBeVisible()
      await pickPartner(page, second)
      await detail.getByRole('button', { name: 'Promijeni podizvođača', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Podizvođač promijenjen' })).toBeVisible()
      await expect(rideRow(page, guest)).toContainText(second)
      await expect(rideRow(page, guest)).not.toContainText(first)

      if (theme === 'light') {
        await openRide(page, day, rideId, guest)
        await switchLocale(page, 'en')
        await expect(detail.getByText('Handed off').first()).toBeVisible()
        await detail.getByRole('button', { name: 'More', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: 'Change subcontractor', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await switchLocale(page, 'hr')
        await detail.getByRole('button', { name: 'Više', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: 'Promijeni podizvođača', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
      }

      await openRide(page, day, rideId, guest)
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Vrati vožnju', exact: true }).click()
      const takeBack = page.getByRole('dialog', { name: 'Vraćanje vožnje' })
      await takeBack.getByRole('button', { name: 'Vrati vožnju', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Vožnja vraćena' })).toBeVisible()
      await expect(rideRow(page, guest)).toContainText('Nedodijeljeno')
      await expect(rideRow(page, guest)).not.toContainText(second)

      await openRide(page, day, rideId, guest)
      await handOff(page, first)
      await openRide(page, day, rideId, guest)
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Označi nedolazak', exact: true })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await detail.getByRole('button', { name: 'Obavljeno', exact: true }).click()
      const done = page.getByRole('dialog', { name: 'Označi vožnju obavljenom' })
      await done.getByRole('button', { name: 'Označi obavljenom', exact: true }).click()
      await expect(rideRow(page, guest)).toContainText('Obavljeno')
      await openRide(page, day, rideId, guest)
      await expect(detail.getByText('Obavljeno').first()).toBeVisible()
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true })).toHaveCount(0)
      await expect(page.getByRole('menuitem', { name: 'Promijeni podizvođača', exact: true })).toHaveCount(0)
    })
  }
})
