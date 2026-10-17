import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, openMembers, signIn } from './fixtures/ui'

test('admin changes a role and removes the member through the confirmation modal', async ({ page }) => {
  const tenant = await seedTenant('members')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozač')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openMembers(page)

  const row = page.getByRole('row', { name: driver.name })
  await row.getByRole('button', { name: `Radnje: ${driver.name}` }).click()
  await page.getByRole('menuitem', { name: 'Promijeni ulogu', exact: true }).click()
  const roleDialog = page.getByRole('dialog', { name: 'Promijeni ulogu' })
  await expect(roleDialog).toContainText(`Nova uloga vrijedi odmah. ${driver.name} gubi pristup prethodne uloge.`)
  await chooseOption(page, roleDialog.getByRole('combobox', { name: 'Nova uloga' }), 'Dispečer')
  await roleDialog.getByRole('button', { name: 'Promijeni ulogu', exact: true }).click()
  await expect(roleDialog).toBeHidden()
  await expect(row).toContainText('Dispečer')

  await row.getByRole('button', { name: `Radnje: ${driver.name}` }).click()
  await page.getByRole('menuitem', { name: 'Ukloni', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(driver.name)
  await expect(dialog).toContainText('Jeste li sigurni da želite ukloniti ovog člana?')
  await expect(dialog).toContainText('Odmah će izgubiti pristup.')
  await dialog.getByRole('button', { name: 'Da, ukloni', exact: true }).click()
  await expect(page.getByRole('row', { name: driver.name })).toHaveCount(0)
})
