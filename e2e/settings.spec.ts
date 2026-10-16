import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { chooseOption, openListbox, signIn, switchLocale, switchTheme } from './fixtures/ui'

test('admin changes the waits and the time zone, and the audit log updates', async ({ page }) => {
  const tenant = await seedTenant('settings')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openSettingsTab(page, 'Tvrtka')
  const settings = page.getByRole('region', { name: 'Postavke' })

  await settings.getByLabel('Čekanje na aerodromu (minute)').fill('45')
  await settings.getByLabel('Čekanje izvan aerodroma (minute)').fill('30')
  const listbox = await openListbox(page, settings.getByLabel('Vremenska zona'))
  await listbox.locator('input').fill('Europe/London')
  const london = listbox.getByRole('option', { name: 'Europe/London', exact: true })
  await expect(london).toBeVisible()
  await london.click()
  await expect(listbox).toBeHidden()
  await settings.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' })).toBeVisible()

  // The log is on Audit. Opening it reads the rows the save already wrote.
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Promijenjeno čekanje na aerodromu', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '90 → 45 min', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Promijenjeno čekanje izvan aerodroma', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '25 → 30 min', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Promijenjena vremenska zona', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Europe/Zagreb → Europe/London', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Osvježi', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Postavke' })).toHaveCount(0)

  await page.goto('/settings/tenant')
  await expect(settings.getByLabel('Čekanje na aerodromu (minute)')).toHaveValue('45')
  await expect(settings.getByLabel('Čekanje izvan aerodroma (minute)')).toHaveValue('30')
  await expect(settings.getByLabel('Vremenska zona')).toContainText('Europe/London')
})

test('admin sets the operational-day start and sees it after reload, in light and in dark', async ({ page }) => {
  const tenant = await seedTenant('settings-hour')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openSettingsTab(page, 'Tvrtka')
  const settings = page.getByRole('region', { name: 'Postavke' })
  const hour = settings.getByLabel('Sat početka operativnog dana')

  await expect(hour).toContainText('05:00')
  await chooseOption(page, hour, '06:00')
  await settings.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' })).toBeVisible()

  await page.goto('/audit')
  await expect(page.getByRole('cell', { name: 'Promijenjen sat početka operativnog dana', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '05:00 → 06:00', exact: true })).toBeVisible()

  await page.goto('/settings/tenant')
  await expect(hour).toContainText('06:00')
  await expect(settings.getByLabel('Čekanje na aerodromu (minute)')).toHaveValue('90')
  await expect(settings.getByLabel('Čekanje izvan aerodroma (minute)')).toHaveValue('25')

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByLabel('Sat početka operativnog dana')).toContainText('06:00')

  await switchLocale(page, 'en')
  await expect(page.getByLabel('Operational day starts at')).toContainText('06:00')
  await page.goto('/audit')
  await expect(page.getByRole('cell', { name: 'Operational day start changed', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: '05:00 → 06:00', exact: true })).toBeVisible()
})

/** Settings in the sidebar, then the named tab. */
async function openSettingsTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Postavke tvrtke', exact: true }).click()
  await page.getByRole('navigation', { name: 'Postavke' }).getByRole('link', { name, exact: true }).click()
}
