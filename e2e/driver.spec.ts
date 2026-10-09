import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

/**
 * The list that page loads for office staff. A Driver is sent Home before
 * the page mounts, so the browser must not request it.
 */
const officeVisits = [
  { path: '/clients', collection: '/api/clients' },
  { path: '/locations', collection: '/api/locations' },
  { path: '/drivers', collection: '/api/drivers' },
  { path: '/vehicles', collection: '/api/vehicles' },
  { path: '/roster', collection: '/api/roster' },
  { path: '/transfers', collection: '/api/transfers' },
] as const

test('a driver who opens an office address lands on Driver Home before office data loads', async ({ page }) => {
  const tenant = await seedTenant('driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozač')
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Postavke', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Klijenti' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Lokacije' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Vozila' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Vozači' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Članovi' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Spremi', exact: true })).toHaveCount(0)
  await expect(page.getByText('Samo administrator može ovo promijeniti.')).toBeVisible()

  for (const visit of officeVisits)
    await expectOfficeAddressReturnsHome(page, visit.path, visit.collection, tenant.name)
})

/** Home, with the Tenant name as the only h1, and no request for that page's collection. */
async function expectOfficeAddressReturnsHome(page: Page, path: string, collection: string, tenantName: string) {
  const requested: string[] = []
  const onRequest = (request: { method: () => string, url: () => string }) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === collection)
      requested.push(request.url())
  }
  page.on('request', onRequest)
  try {
    await page.goto(path)
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: tenantName })).toBeVisible()
    expect(requested).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
}
