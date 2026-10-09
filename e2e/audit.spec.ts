import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('an admin opens the audit log from the sidebar, newest first, and can refresh', async ({ page }) => {
  const tenant = await seedTenant('audit-admin')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozač')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav.getByRole('link', { name: 'Revizijski zapisnik', exact: true })).toBeVisible()

  await page.goto('/settings/members')
  const member = page.getByRole('row', { name: driver.name })
  await member.getByRole('combobox', { name: 'Uloga' }).click()
  await page.getByRole('option', { name: 'Dispečer', exact: true }).click()
  await expect(member.getByRole('combobox', { name: 'Uloga' })).toContainText('Dispečer')

  await page.goto('/settings/tenant')
  const settings = page.getByRole('region', { name: 'Postavke' })
  await settings.getByLabel('Čekanje na aerodromu (minute)').fill('45')
  await settings.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' })).toBeVisible()

  // Opening Audit reads the rows already written. The log does not update while this page is open.
  await nav.getByRole('link', { name: 'Revizijski zapisnik', exact: true }).click()
  await expect(page).toHaveURL(/\/audit$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Revizijski zapisnik' })).toBeVisible()

  const rows = page.getByRole('row').filter({ has: page.getByRole('cell') })
  await expect(rows.nth(0)).toContainText('Promijenjeno čekanje na aerodromu')
  await expect(rows.nth(0)).toContainText('90 → 45 min')
  await expect(rows.nth(1)).toContainText('Uloga promijenjena')

  const seen: string[] = []
  const onRequest = (request: { method: () => string, url: () => string }) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/audit-entries')
      seen.push(request.url())
  }
  page.on('request', onRequest)
  try {
    await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
    await expect.poll(() => seen.length).toBeGreaterThan(0)
    await expect(rows.nth(0)).toContainText('Promijenjeno čekanje na aerodromu')
    await expect(rows.nth(1)).toContainText('Uloga promijenjena')
  }
  finally {
    page.off('request', onRequest)
  }
})

test('a dispatcher has no audit item in the sidebar', async ({ page }) => {
  const tenant = await seedTenant('audit-disp-nav')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav.getByRole('link', { name: 'Početna', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Postavke', exact: true })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Revizijski zapisnik', exact: true })).toHaveCount(0)
})

test('a dispatcher who opens /audit lands on home without requesting the audit log', async ({ page }) => {
  const tenant = await seedTenant('audit-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await expectAuditRedirectsHome(page, tenant.name)
  await expect(page.getByText('Primjer vremena')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
})

test('a driver who opens /audit lands on home without requesting the audit log', async ({ page }) => {
  const tenant = await seedTenant('audit-drv')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, driver.email, driver.password, tenant.name)
  await expectAuditRedirectsHome(page, tenant.name)
  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
})

test('a signed-out visit to /audit shows the sign-in form', async ({ page }) => {
  await page.goto('/audit')
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prijavi se', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toHaveCount(0)
})

/** Home, and the browser never calls the audit endpoint while the address is refused. */
async function expectAuditRedirectsHome(page: Page, tenantName: string) {
  const seen: string[] = []
  const onRequest = (request: { method: () => string, url: () => string }) => {
    const path = new URL(request.url()).pathname
    if (request.method() === 'GET' && (path === '/api/audit-entries' || path.startsWith('/api/audit-entries/')))
      seen.push(path)
  }
  page.on('request', onRequest)
  try {
    await page.goto('/audit')
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { level: 1, name: tenantName })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    expect(seen).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
}
