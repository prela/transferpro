import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { plantOperationalRows, seedSuperadmin, seedTenant } from './fixtures/seed'
import { signOut } from './fixtures/ui'

const operationalPaths = ['/clients', '/drivers', '/vehicles', '/transfers', '/rides']

test('superadmin lists, opens, and renames a firm in Croatian and English, light and dark', async ({ page }) => {
  const tenant = await seedTenant('platform')
  const planted = await plantOperationalRows(tenant.tenantId)
  const owner = await seedSuperadmin('platform')
  const renamed = `Renamed ${tenant.tenantId.slice(0, 8)}`

  await page.goto('/')
  await page.getByLabel('E-pošta').fill(owner.email)
  await page.getByLabel('Lozinka').fill(owner.password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toBeVisible()
  await expect(page.getByText(owner.email)).toHaveCount(0)
  for (const marker of [planted.clientName, planted.driverName, planted.vehicleDescription, 'E2EVH01'])
    await expect(page.getByText(marker)).toHaveCount(0)

  await page.getByRole('link', { name: tenant.name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
  await expect(page.getByText(tenant.slug, { exact: true })).toBeVisible()
  await expect(page.getByText('Da', { exact: true })).toBeVisible()
  await expect(page.locator('time')).not.toBeEmpty()
  await expectNoOperationalLinks(page)
  for (const marker of [planted.clientName, planted.driverName, planted.vehicleDescription])
    await expect(page.getByText(marker)).toHaveCount(0)

  await page.getByLabel('Naziv').fill(renamed)
  await page.getByLabel('Naziv').press('Enter')
  await expect(page.getByRole('status')).toContainText('Naziv je spremljen.')
  await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible()

  await page.getByRole('button', { name: 'Tamna tema', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Firms', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Light theme', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('superadmin signs out from the firm list', async ({ page }) => {
  await seedTenant('platform-out')
  const owner = await seedSuperadmin('platform-out')

  await page.goto('/')
  await page.getByLabel('E-pošta').fill(owner.email)
  await page.getByLabel('Lozinka').fill(owner.password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toBeVisible()

  await signOut(page)
  const cookies = await page.context().cookies()
  expect(cookies.filter(cookie => cookie.name.includes('session_token') && cookie.value !== '')).toEqual([])
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
  await page.goto('/admin/tenants')
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toHaveCount(0)
})

test('a tenant admin does not get the platform screen', async ({ page }) => {
  const tenant = await seedTenant('platform-admin')
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(tenant.adminEmail)
  await page.getByLabel('Lozinka').fill(tenant.password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()

  await page.goto('/admin/tenants')
  await expect(page.getByRole('alert')).toContainText('Niste član nijednog prijevoznika. Odjavite se ili zatražite novu pozivnicu.')
  await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: tenant.name, exact: true })).toHaveCount(0)
})

async function expectNoOperationalLinks(page: Page) {
  const hrefs = await page.locator('a').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') ?? ''))
  for (const path of operationalPaths)
    expect(hrefs.some(href => href === path || href.startsWith(`${path}/`))).toBe(false)
}
