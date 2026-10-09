import { expect, test } from '@playwright/test'

const officePaths = ['/clients', '/locations', '/drivers', '/vehicles', '/roster', '/transfers', '/admin/tenants'] as const

test('signed-out visits to office and platform pages show the sign-in form', async ({ page }) => {
  for (const path of officePaths) {
    await page.goto(path)
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Prijavi se', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toHaveCount(0)
  }
})
