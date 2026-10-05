import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('admin changes a role and removes the member through the confirmation modal', async ({ page }) => {
  const tenant = await seedTenant('members')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozač')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const row = page.getByRole('row', { name: driver.name })
  await row.getByRole('combobox', { name: 'Uloga' }).click()
  await page.getByRole('option', { name: 'Dispečer', exact: true }).click()
  await expect(row.getByRole('combobox', { name: 'Uloga' })).toContainText('Dispečer')

  await row.getByRole('button', { name: 'Ukloni člana', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(driver.name)
  await expect(dialog).toContainText('Jeste li sigurni da želite ukloniti ovog člana?')
  await dialog.getByRole('button', { name: 'Da, ukloni', exact: true }).click()
  await expect(page.getByRole('row', { name: driver.name })).toHaveCount(0)
})
