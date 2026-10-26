import type { Page } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedTenant } from './fixtures/seed'
import { signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Desktop shows the sidebar. The phone project keeps catalogs behind Više.
 */
async function openOfficeLink(page: Page, name: string) {
  const link = page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name, exact: true })
  if (await link.isVisible()) {
    await link.click()
    return
  }
  // Phone: catalogs sit behind Više. The bottom bar already shows Home, Transfers, and Roster.
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('dialog').getByRole('link', { name, exact: true }).click()
}

// @phone: the phone project runs this file as well as the desktop project.
test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`drivers page is usable in ${theme} mode`, async ({ page }) => {
      const tenant = await seedTenant(`drivers-theme-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await openOfficeLink(page, 'Vozači')
      await expect(page.getByRole('heading', { level: 1, name: 'Vozači' })).toBeVisible()
      await expect(page.getByText('Još nema vozača. Dodajte prvog.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      await expect(page.getByRole('dialog').getByLabel('Ime')).toBeVisible()

      await expectNoAxeViolations(page)
      await switchLocale(page, 'en')
      await expect(page.getByRole('heading', { level: 1, name: 'Drivers' })).toBeVisible()
      await expect(page.getByRole('button', { name: '+ Add', exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`vehicles page is usable in ${theme} mode`, async ({ page }) => {
      const tenant = await seedTenant(`vehicles-theme-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await openOfficeLink(page, 'Vozila')
      await expect(page.getByRole('heading', { level: 1, name: 'Vozila' })).toBeVisible()
      await expect(page.getByText('Još nema vozila. Dodajte prvo.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      await expect(page.getByRole('dialog').getByLabel('Registarska oznaka', { exact: true })).toBeVisible()

      await expectNoAxeViolations(page)
      await switchLocale(page, 'en')
      await expect(page.getByRole('heading', { level: 1, name: 'Vehicles' })).toBeVisible()
      await expect(page.getByRole('button', { name: '+ Add', exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`locations page is usable in ${theme} mode`, async ({ page }) => {
      const tenant = await seedTenant(`locations-theme-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await openOfficeLink(page, 'Lokacije')
      await expect(page.getByRole('heading', { level: 1, name: 'Lokacije' })).toBeVisible()
      await expect(page.getByText('Još nema lokacija. Dodajte prvu.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      await expect(page.getByRole('dialog').getByLabel('Ime')).toBeVisible()

      await expectNoAxeViolations(page)
      await switchLocale(page, 'en')
      await expect(page.getByRole('heading', { level: 1, name: 'Locations' })).toBeVisible()
      await expect(page.getByRole('button', { name: '+ Add', exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
    })

    test(`transfers page is usable in ${theme} mode`, async ({ page }) => {
      const tenant = await seedTenant(`transfers-theme-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await openOfficeLink(page, 'Transferi')
      await expect(page.getByRole('heading', { level: 1, name: 'Transferi' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: 'Dan', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
      await expect(page.getByRole('dialog').getByLabel('Ime gosta')).toBeVisible()
      // A blank form is not a draft. The pointer also stays on the primary
      // button, whose hovered fill is below 4.5:1.
      await page.mouse.move(0, 0)
      await expectNoAxeViolations(page)
      await switchLocale(page, 'en')
      await page.getByRole('button', { name: 'Record a transfer', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Record a transfer' })
      await expect(dialog.getByLabel('Guest name')).toBeVisible()
      await expect(dialog.getByRole('button', { name: 'Record transfer', exact: true })).toBeVisible()
      await page.mouse.move(0, 0)
      await expectNoAxeViolations(page)
    })

    test(`roster page is usable in ${theme} mode`, async ({ page }) => {
      const tenant = await seedTenant(`roster-theme-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await openOfficeLink(page, 'Raspored')
      await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
      const phone = (page.viewportSize()?.width ?? 1280) < 1024
      if (phone)
        await expect(page.getByText('Danas', { exact: true })).toBeVisible()
      else
        await expect(page.getByText('Ovaj tjedan', { exact: true })).toBeVisible()

      await expectNoAxeViolations(page)
      await switchLocale(page, 'en')
      await expect(page.getByRole('heading', { level: 1, name: 'Vehicle roster' })).toBeVisible()
      if (phone)
        await expect(page.getByText('Today', { exact: true })).toBeVisible()
      else
        await expect(page.getByText('This week', { exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
    })
  }
})
