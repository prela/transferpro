import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('admin changes the waits and the time zone, and the audit log updates', async ({ page }) => {
  const tenant = await seedTenant('settings')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openSettingsTab(page, 'Organizacija')
  const settings = page.getByRole('region', { name: 'Postavke' })

  await settings.getByLabel('Čekanje na aerodromu (minute)').fill('45')
  await settings.getByLabel('Čekanje izvan aerodroma (minute)').fill('30')
  await settings.getByLabel('Vremenska zona').click()
  await page.getByRole('combobox', { name: 'Vremenska zona' }).fill('Europe/London')
  await page.getByRole('option', { name: 'Europe/London', exact: true }).click()
  await settings.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' })).toBeVisible()

  // The log is on Audit. Opening it reads the rows the save already wrote.
  await page.goto('/audit')
  await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toBeVisible()
  await expect(page.getByText('Promijenjeno čekanje na aerodromu')).toBeVisible()
  await expect(page.getByText('90 → 45 min')).toBeVisible()
  await expect(page.getByText('Promijenjeno čekanje izvan aerodroma')).toBeVisible()
  await expect(page.getByText('25 → 30 min')).toBeVisible()
  await expect(page.getByText('Promijenjena vremenska zona')).toBeVisible()
  await expect(page.getByText('Europe/Zagreb → Europe/London')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Osvježi', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Postavke' })).toHaveCount(0)

  await page.goto('/settings/tenant')
  await expect(settings.getByLabel('Čekanje na aerodromu (minute)')).toHaveValue('45')
  await expect(settings.getByLabel('Čekanje izvan aerodroma (minute)')).toHaveValue('30')
  await expect(settings.getByLabel('Vremenska zona')).toContainText('Europe/London')
})

/** Settings in the sidebar, then the named tab. */
async function openSettingsTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Postavke', exact: true }).click()
  await page.getByRole('navigation', { name: 'Postavke' }).getByRole('link', { name, exact: true }).click()
}
