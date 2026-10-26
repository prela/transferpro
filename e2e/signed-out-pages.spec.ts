import { expect, test } from './fixtures/playwright'

const officePaths = ['/clients', '/partners', '/locations', '/drivers', '/vehicles', '/roster', '/transfers', '/settings', '/settings/tenant', '/settings/members', '/settings/profile', '/profile', '/audit', '/admin/tenants'] as const

test('signed-out visits to office, settings, and platform pages show the sign-in form', async ({ page }) => {
  for (const path of officePaths) {
    await page.goto(path)
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Prijavi se', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toHaveCount(0)
  }
})

test('a differently cased protected route stays protected and a public route stays public', async ({ page }) => {
  // `/Transfers` is an office screen. The page router matches it in any case.
  for (const path of ['/Transfers', '/Settings', '/Admin/tenants'] as const) {
    await page.goto(path)
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Prijavi se', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toHaveCount(0)
  }

  await page.goto('/Forgot-password')
  await expect(page).toHaveURL(/\/forgot-password$/i)
  await expect(page.getByRole('heading', { level: 2, name: 'Zaboravljena lozinka' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pošalji poveznicu', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prijavi se', exact: true })).toHaveCount(0)
})

test('worker and manifest headers stay put, and a foreign origin is not allowed', async ({ page }) => {
  const worker = await page.request.get('/sw.js')
  expect(worker.ok()).toBeTruthy()
  expect(worker.headers()['cache-control']).toBe('no-cache')

  const manifest = await page.request.get('/manifest.webmanifest')
  expect(manifest.ok()).toBeTruthy()
  expect(manifest.headers()['content-type']).toContain('application/manifest+json')

  const crossed = await page.request.get('/sw.js', {
    headers: { origin: 'https://evil.example' },
  })
  expect(crossed.headers()['access-control-allow-origin'] ?? '').toBe('')
  expect(crossed.headers()['cache-control']).toBe('no-cache')
})
