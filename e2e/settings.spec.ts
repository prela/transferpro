import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('admin changes the waits and the time zone, and the audit log updates', async ({ page }) => {
  const tenant = await seedTenant('settings')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const settings = page.getByRole('region', { name: 'Postavke' })

  await settings.getByLabel('Čekanje na aerodromu (minute)').fill('45')
  await settings.getByLabel('Čekanje izvan aerodroma (minute)').fill('30')
  await settings.getByLabel('Vremenska zona').click()
  await page.getByRole('combobox', { name: 'Vremenska zona' }).fill('Europe/London')
  await page.getByRole('option', { name: 'Europe/London', exact: true }).click()
  await settings.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' })).toBeVisible()

  await page.reload()
  await expect(settings.getByLabel('Čekanje na aerodromu (minute)')).toHaveValue('45')
  await expect(settings.getByLabel('Čekanje izvan aerodroma (minute)')).toHaveValue('30')
  await expect(settings.getByLabel('Vremenska zona')).toContainText('Europe/London')

  await expect(page.getByText('Promijenjeno čekanje na aerodromu')).toBeVisible()
  await expect(page.getByText('90 → 45 min')).toBeVisible()
  await expect(page.getByText('Promijenjeno čekanje izvan aerodroma')).toBeVisible()
  await expect(page.getByText('25 → 30 min')).toBeVisible()
  await expect(page.getByText('Promijenjena vremenska zona')).toBeVisible()
  await expect(page.getByText('Europe/Zagreb → Europe/London')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Osvježi', exact: true })).toBeVisible()
})
