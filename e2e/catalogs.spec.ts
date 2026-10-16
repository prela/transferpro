import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { chooseOption, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Catalog pattern (issue #263). The phone project runs this block.
 * The desktop project runs it at the beside-the-table width.
 */

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

async function openOfficeLink(page: Page, name: string) {
  const link = page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name, exact: true })
  if (await link.isVisible()) {
    await link.click()
    return
  }
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('dialog').getByRole('link', { name, exact: true }).click()
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`clients and locations follow the catalog pattern in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`catalog-pattern-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      await openOfficeLink(page, 'Naručitelji')
      await expect(page.getByRole('searchbox', { name: 'Traži' })).toBeVisible()
      await expect(page.getByText('Još nema naručitelja. Dodajte prvog.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      const addClient = page.getByRole(phone ? 'dialog' : 'region', { name: 'Dodaj naručitelja' })
      await expect(addClient.getByLabel('Ime')).toBeVisible()
      await addClient.getByRole('button', { name: 'Zatvori', exact: true }).click()
      await expect(addClient).toBeHidden()

      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      const clientForm = page.getByRole(phone ? 'dialog' : 'region', { name: 'Dodaj naručitelja' })
      await clientForm.getByLabel('Ime').fill('Hotel Jadran')
      await chooseOption(page, clientForm.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
      await clientForm.getByRole('button', { name: 'Dodaj naručitelja', exact: true }).click()
      await expect(clientForm).toBeHidden()
      await expect(page.getByRole('button', { name: 'Hotel Jadran', exact: true })).toBeVisible()
      if (phone) {
        await expect(page.getByRole('columnheader', { name: 'Vrsta' })).toBeHidden()
        await expect(page.getByRole('row', { name: 'Hotel Jadran Hotel' })).toBeVisible()
      }
      else {
        await expect(page.getByRole('columnheader', { name: 'Vrsta' })).toBeVisible()
        await expect(page.getByRole('cell', { name: 'Hotel', exact: true })).toBeVisible()
      }
      await expectNoAxeViolations(page)

      await openOfficeLink(page, 'Lokacije')
      await expect(page.getByRole('searchbox', { name: 'Traži' })).toBeVisible()
      await expect(page.getByLabel('Prikaži arhivirano')).toBeVisible()
      await expect(page.getByText('Još nema lokacija. Dodajte prvu.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      const addLocation = page.getByRole(phone ? 'dialog' : 'region', { name: 'Dodaj lokaciju' })
      await expect(addLocation.getByLabel('Adresa')).toBeVisible()
      await addLocation.getByRole('button', { name: 'Odustani', exact: true }).click()
      await expect(addLocation).toBeHidden()
      await expectNoAxeViolations(page)

      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('heading', { level: 1, name: 'Locations' })).toBeVisible()
        await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible()
        await expect(page.getByLabel('Show archived')).toBeVisible()
        await expect(page.getByRole('button', { name: '+ Add', exact: true })).toBeVisible()
        await expect(page.getByText('No locations yet. Add the first one.')).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })

    test(`drivers, vehicles, and audit follow the catalog pattern in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`catalog-fleet-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      await openOfficeLink(page, 'Vozači')
      await expect(page.getByRole('searchbox', { name: 'Traži' })).toBeVisible()
      await expect(page.getByText('Još nema vozača. Dodajte prvog.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      const addDriver = page.getByRole(phone ? 'dialog' : 'region', { name: 'Dodaj vozača' })
      await expect(addDriver.getByLabel('Ime')).toBeVisible()
      await addDriver.getByRole('button', { name: 'Zatvori', exact: true }).click()
      await expect(addDriver).toBeHidden()
      await expectNoAxeViolations(page)

      await openOfficeLink(page, 'Vozila')
      await expect(page.getByRole('searchbox', { name: 'Traži' })).toBeVisible()
      await expect(page.getByLabel('Prikaži arhivirano')).toBeVisible()
      await expect(page.getByText('Još nema vozila. Dodajte prvo.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      const addVehicle = page.getByRole(phone ? 'dialog' : 'region', { name: 'Dodaj vozilo' })
      await expect(addVehicle.getByLabel('Registarska oznaka', { exact: true })).toBeVisible()
      await addVehicle.getByRole('button', { name: 'Odustani', exact: true }).click()
      await expect(addVehicle).toBeHidden()
      await expectNoAxeViolations(page)

      await openOfficeLink(page, 'Revizija')
      await expect(page.getByRole('heading', { level: 1, name: 'Revizijski zapisnik' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Osvježi', exact: true })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Vrijeme' })).toBeVisible()
      await expect(page.getByRole('columnheader', { name: 'Član' })).toHaveCount(0)
      if (phone) {
        await expect(page.getByRole('columnheader', { name: 'Tko' })).toBeHidden()
        await expect(page.getByRole('columnheader', { name: 'Radnja' })).toBeHidden()
        await expect(page.getByRole('columnheader', { name: 'Detalj' })).toBeHidden()
      }
      else {
        await expect(page.getByRole('columnheader', { name: 'Tko' })).toBeVisible()
        await expect(page.getByRole('columnheader', { name: 'Radnja' })).toBeVisible()
        await expect(page.getByRole('columnheader', { name: 'Detalj' })).toBeVisible()
      }
      await expectNoAxeViolations(page)

      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('heading', { level: 1, name: 'Audit log' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})
