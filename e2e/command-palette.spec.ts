import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedTenant } from './fixtures/seed'
import { hydrated, signIn, signOut, switchLocale, useTheme } from './fixtures/ui'

/**
 * Command palette (issue #258). The phone project runs the @phone block.
 * No earlier spec pinned this palette; the within-day search stays as it was.
 */

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

async function openPalette(page: Page, name: 'Traži' | 'Search') {
  if (isPhone(page))
    await page.getByRole('button', { name, exact: true }).click()
  else
    await page.keyboard.press('Control+K')
  await expect(page.getByRole('dialog', { name })).toBeVisible()
}

test('a Client reference, a guest, and a flight number each open that Ride on its day', async ({ page }) => {
  const tenant = await seedTenant('palette-search')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Paleta', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Paleta', kind: 'hotel' })
  const clientId = await createdId(page, '/api/clients', { name: 'Agencija Paleta', kind: 'agency' })
  const day = addCalendarDays(operationalDateInTimeZone('Europe/Zagreb', new Date()), 4)
  const guest = 'Mara Paleta'
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      flightNumber: 'OU258',
      price: 10,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
      tabla: '',
      clientReference: 'PAL258',
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id

  await hydrated(page)
  const box = page.getByRole('dialog', { name: 'Traži' }).getByRole('textbox', { name: 'Zaslon, naredba ili transfer' })

  async function findAndOpen(query: string) {
    await openPalette(page, 'Traži')
    await box.fill(query)
    const option = page.getByRole('option', { name: guest })
    await expect(option).toBeVisible()
    await option.click()
    await expect(page).toHaveURL(new RegExp(`[?&]day=${day}`))
    await expect(page).toHaveURL(new RegExp(`[?&]ride=${rideId}`))
    await expect(page.getByRole('heading', { level: 2, name: guest, exact: true })).toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Traži' })).toHaveCount(0)
  }

  await findAndOpen('PAL258')
  await findAndOpen(guest)
  await findAndOpen('OU258')
})

test('the palette lists the screens the role may open, and Esc returns focus', async ({ page }) => {
  const tenant = await seedTenant('palette-role')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await hydrated(page)
  const phone = isPhone(page)

  if (phone)
    await expect(page.getByRole('button', { name: 'Traži', exact: true })).toBeVisible()
  else
    await expect(page.getByRole('button', { name: 'Traži', exact: true })).toHaveCount(0)

  const returnFocus = phone
    ? page.getByRole('button', { name: 'Traži', exact: true })
    : page.getByRole('button', { name: 'Novi transfer', exact: true })
  await returnFocus.focus()
  await openPalette(page, 'Traži')
  await expect(page.getByRole('option', { name: 'Revizija', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Postavke tvrtke', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Novi transfer', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: /Idi na dan…/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Traži' })).toHaveCount(0)
  await expect(returnFocus).toBeFocused()

  const typed = page.getByRole('dialog', { name: 'Traži' }).getByRole('textbox', { name: 'Zaslon, naredba ili transfer' })
  await openPalette(page, 'Traži')
  await typed.fill('3.11.2026')
  await page.getByRole('option', { name: 'Idi na dan 03. 11. 2026.', exact: true }).click()
  await expect(page).toHaveURL(/day=2026-11-03/)
  await expect(page.getByLabel('Dan')).toHaveValue('2026-11-03')

  await signOut(page)
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await hydrated(page)
  await openPalette(page, 'Traži')
  await expect(page.getByRole('option', { name: 'Naručitelji', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Transferi', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Revizija', exact: true })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'Postavke tvrtke', exact: true })).toHaveCount(0)
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the command palette follows ${theme} and passes axe`, async ({ page }) => {
      const tenant = await seedTenant(`palette-axe-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await hydrated(page)
      await openPalette(page, 'Traži')
      await expect(page.getByRole('option', { name: 'Novi transfer', exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await page.keyboard.press('Escape')
        await switchLocale(page, 'en')
        await openPalette(page, 'Search')
        await expect(page.getByRole('option', { name: /Go to day…/ })).toBeVisible()
        await expect(page.getByRole('option', { name: 'Clients', exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})
