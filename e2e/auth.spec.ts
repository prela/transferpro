import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedTenant, seedUserWithoutMembership } from './fixtures/seed'
import { signIn, signOut, useTheme } from './fixtures/ui'

/** English sign-out lives in the navbar menu. The trigger names the Tenant. */
async function openUserMenu(page: Page, tenantName: string) {
  await page.getByRole('button', { name: tenantName, exact: true }).click()
  await expect(page.getByRole('menu')).toBeVisible()
}

test('admin signs in and signs out', async ({ page }) => {
  const tenant = await seedTenant('auth')
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')
  await signOut(page)
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toHaveCount(0)
  await expect(page.getByLabel('E-pošta')).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')
  const cookies = await page.context().cookies()
  expect(cookies.filter(cookie => cookie.name.includes('session_token') && cookie.value !== '')).toEqual([])
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
})

test('sign-out from an office page clears the tenant, returns to Croatian, and keeps the theme', async ({ page }) => {
  const tenant = await seedTenant('auth-office-out')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Klijenti' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()
  await signOut(page)
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toHaveCount(0)
  await expect(page.getByText(tenant.name)).toHaveCount(0)
  await expect(page.getByLabel('E-pošta')).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('light')
})

test('the next sign-in loads the member locale from the session shell', async ({ page }) => {
  const tenant = await seedTenant('auth-locale')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await openUserMenu(page, tenant.name)
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toHaveCount(0)
  await page.getByLabel('E-pošta').fill(tenant.adminEmail)
  await page.getByLabel('Lozinka').fill(tenant.password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
  await expect(page.getByText('Tenant', { exact: true })).toBeVisible()
  await openUserMenu(page, tenant.name)
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible()
})

test('a failed sign-out keeps the tenant and shows the failure', async ({ page }) => {
  const tenant = await seedTenant('auth-sign-out-fail')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.route('**/api/auth/sign-out', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await openUserMenu(page, tenant.name)
  await page.getByRole('menuitem', { name: 'Odjava', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Odjava nije uspjela. Pokušajte ponovno.' })).toBeVisible()
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
  await openUserMenu(page, tenant.name)
  await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible()
})
