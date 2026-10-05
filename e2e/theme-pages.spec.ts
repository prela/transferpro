import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { signIn, useTheme } from './fixtures/ui'

for (const theme of ['light', 'dark'] as const) {
  test(`drivers page is usable in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`drivers-theme-${theme}`)
    await useTheme(page, theme)
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.getByRole('link', { name: 'Vozači' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Vozači' })).toBeVisible()
    await expect(page.getByLabel('Ime')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dodaj vozača', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Drivers' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add driver', exact: true })).toBeVisible()
  })

  test(`vehicles page is usable in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`vehicles-theme-${theme}`)
    await useTheme(page, theme)
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.getByRole('link', { name: 'Vozila' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Vozila' })).toBeVisible()
    await expect(page.getByLabel('Registarska oznaka', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dodaj vozilo', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Vehicles' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add vehicle', exact: true })).toBeVisible()
  })

  test(`locations page is usable in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`locations-theme-${theme}`)
    await useTheme(page, theme)
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.getByRole('link', { name: 'Lokacije' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Lokacije' })).toBeVisible()
    await expect(page.getByLabel('Ime')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Dodaj lokaciju', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Locations' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add location', exact: true })).toBeVisible()
  })

  test(`roster page is usable in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`roster-theme-${theme}`)
    await useTheme(page, theme)
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.getByRole('link', { name: 'Raspored' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
    await expect(page.getByLabel('Datum')).toBeVisible()

    await page.getByRole('button', { name: 'English', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Vehicle roster' })).toBeVisible()
    await expect(page.getByLabel('Date')).toBeVisible()
  })
}
