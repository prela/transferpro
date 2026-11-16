import type { Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { seedTenant } from './fixtures/seed'
import { hydrated, openNewTransfer, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * A new Transfer suggests the shown operational day (issue #565).
 * The phone project runs the @phone block. Each test pins the clock once.
 * A later jump would look like a quiet office and sign the session out.
 * Duplicate, return, and an extra vehicle keep the prefill already covered
 * in duplicate-return-print.
 */

const zone = 'Europe/Zagreb'
const calendar = calendarDateInTimeZone(zone, new Date())
// 02:20 on today's Zagreb date. The board shows yesterday. The next full hour is 03:00.
const night = instantFromWallClock(`${calendar}T02:20`, zone)
const nightSuggestion = `${calendar}T03:00`
const shownNight = addCalendarDays(calendar, -1)
// 10:00 is inside the operational day. Another shown day stays at noon.
const daytime = instantFromWallClock(`${calendar}T10:00`, zone)
const otherDay = addCalendarDays(calendar, 2)
const draftPickup = `${calendar}T09:45`
const draftGuest = 'Noćna Skica'

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

async function openPalette(page: Page, locale: 'hr' | 'en') {
  const name = locale === 'hr' ? 'Traži' : 'Search'
  if (isPhone(page))
    await page.getByRole('button', { name, exact: true }).click()
  else
    await page.keyboard.press('Control+K')
  await expect(page.getByRole('dialog', { name })).toBeVisible()
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the night window suggests the next full hour in ${theme}, and a draft wins`, async ({ page }) => {
      test.setTimeout(120_000)
      await pinOperationalClock(page, night)
      await useTheme(page, theme)
      const tenant = await seedTenant(`suggest-night-${theme}`)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      // Home's + Novi transfer (top bar, or the phone button) opens Transfers.
      await openNewTransfer(page)
      const form = page.getByRole('dialog', { name: 'Zabilježi transfer' })
      await expect(form.getByLabel('Vrijeme preuzimanja')).toHaveValue(nightSuggestion)

      await form.getByLabel('Vrijeme preuzimanja').fill(draftPickup)
      await form.getByLabel('Ime gosta').fill(draftGuest)
      await expect.poll(() => page.evaluate((guest) => {
        const raw = Object.entries(localStorage).find(([key]) => key.startsWith('transferpro-transfer-draft:'))?.[1] ?? ''
        return raw.includes(guest)
      }, draftGuest)).toBe(true)
      // The return to Transfers restores the draft in English. The pickup stays the draft's.
      await switchLocale(page, 'en')
      const restored = page.getByRole('dialog', { name: 'Record a transfer' })
      await expect(restored.getByText('Unfinished entry restored')).toBeVisible()
      await expect(restored.getByLabel('Pickup time')).toHaveValue(draftPickup)
      await expect(restored.getByLabel('Guest name')).toHaveValue(draftGuest)
      await restored.getByRole('button', { name: 'Discard', exact: true }).click()
      await expect(restored).toBeHidden()

      await expect(page.getByRole('textbox', { name: 'Day', exact: true })).toHaveValue(shownNight)
      await openPalette(page, 'en')
      await page.getByRole('option', { name: 'New transfer', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Record a transfer' }).getByLabel('Pickup time')).toHaveValue(nightSuggestion)
    })

    test(`another shown day suggests noon in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      await pinOperationalClock(page, daytime)
      await useTheme(page, theme)
      const tenant = await seedTenant(`suggest-day-${theme}`)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await page.goto(`/transfers?day=${otherDay}`)
      await hydrated(page)
      await expect(page.getByRole('textbox', { name: 'Dan', exact: true })).toHaveValue(otherDay)
      await openNewTransfer(page)
      const form = page.getByRole('dialog', { name: 'Zabilježi transfer' })
      await expect(form.getByLabel('Vrijeme preuzimanja')).toHaveValue(`${otherDay}T12:00`)

      await switchLocale(page, 'en')
      // The phone form covers the day control. Read it before the form opens.
      await expect(page.getByRole('textbox', { name: 'Day', exact: true })).toHaveValue(otherDay)
      await openNewTransfer(page)
      const english = page.getByRole('dialog', { name: 'Record a transfer' })
      await expect(english.getByLabel('Pickup time')).toHaveValue(`${otherDay}T12:00`)
    })
  }
})
