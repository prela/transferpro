import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { openMembers, signIn } from './fixtures/ui'

test('an admin cannot change or remove themselves, and can cancel a removal', async ({ page }) => {
  const tenant = await seedTenant('members-guards')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openMembers(page)

  const selfRow = page.getByRole('row', { name: tenant.adminName })
  await expect(selfRow.getByText('(vi)', { exact: true })).toBeVisible()
  await expect(selfRow.getByRole('combobox', { name: 'Uloga' })).toHaveCount(0)
  await expect(selfRow.getByRole('button', { name: 'Ukloni člana', exact: true })).toHaveCount(0)
  await expect(selfRow).toContainText('Administrator')

  const other = page.getByRole('row', { name: driver.name })
  await other.getByRole('button', { name: 'Ukloni člana', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(driver.name)
  await expect(dialog).toContainText('Jeste li sigurni da želite ukloniti ovog člana?')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('row', { name: driver.name })).toBeVisible()
})
