import { expect, test } from '@playwright/test'
import { seedTenant, seedUserWithoutMembership } from './fixtures/seed'
import { signIn, signOut } from './fixtures/ui'

test('admin signs in and signs out', async ({ page }) => {
  const tenant = await seedTenant('auth')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await signOut(page)
})

test('wrong password shows an error', async ({ page }) => {
  const tenant = await seedTenant('auth-wrong')
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(tenant.adminEmail)
  await page.getByLabel('Lozinka').fill('not-the-password')
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Prijava nije uspjela. Provjerite e-poštu i lozinku pa pokušajte ponovno.')
})

test('a user with no membership sees the no-access message', async ({ page }) => {
  const user = await seedUserWithoutMembership('auth')
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(user.email)
  await page.getByLabel('Lozinka').fill(user.password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Niste član nijednog prijevoznika. Odjavite se ili zatražite novu pozivnicu.')
})

test('english smoke: the shell follows the language switch', async ({ page }) => {
  const tenant = await seedTenant('auth-en')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByText('Tenant', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
})
