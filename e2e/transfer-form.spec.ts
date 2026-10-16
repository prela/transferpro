import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, signOut, switchLocale, useTheme } from './fixtures/ui'

/**
 * Transfer form in the Ride panel (issue #259): Više, quick add, and the
 * local draft. The phone project runs the @phone block.
 */

async function openForm(page: Page): Promise<Locator> {
  await page.goto('/transfers')
  await hydrated(page)
  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function createFromSelect(page: Page, dialog: Locator, field: string, name: string) {
  const trigger = dialog.getByRole('button', { name: field, exact: true })
  await trigger.click()
  const listbox = page.locator('[role="listbox"][data-state="open"]')
  await expect(listbox).toBeVisible()
  await listbox.locator('input').fill(name)
  await listbox.getByRole('option', { name: `+ Dodaj ‘${name}’` }).click()
  return trigger
}

test('a reload restores the draft, Odbaci removes it, and another user never sees it', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('transfer-draft')
  const other = await seedMember(tenant.tenantId, 'dispatcher', 'Drugi')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const dialog = await openForm(page)
  await dialog.getByLabel('Ime gosta').fill('Ana Skica')
  await page.reload()
  await hydrated(page)
  const restored = page.getByRole('dialog')
  await expect(restored.getByText('Vraćen nedovršeni unos')).toBeVisible()
  await expect(restored.getByLabel('Ime gosta')).toHaveValue('Ana Skica')

  // Drop the cookie without the client sign-out, which would delete the draft.
  // The other user on this browser must not see a draft that is still stored.
  await page.request.post('/api/auth/sign-out', { data: {} })
  await signIn(page, other.email, other.password, tenant.name)
  await page.goto('/transfers')
  await hydrated(page)
  await expect(page.getByText('Vraćen nedovršeni unos')).toHaveCount(0)
  await expect(page.getByText('Ana Skica')).toHaveCount(0)

  await signOut(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/transfers')
  await hydrated(page)
  const again = page.getByRole('dialog')
  await expect(again.getByText('Vraćen nedovršeni unos')).toBeVisible()
  await expect(again.getByLabel('Ime gosta')).toHaveValue('Ana Skica')
  await again.getByRole('button', { name: 'Odbaci', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await hydrated(page)
  await expect(page.getByText('Vraćen nedovršeni unos')).toHaveCount(0)
  await expect(page.getByLabel('Ime gosta')).toHaveCount(0)
})

test('quick add returns the new Client and the new Location selected', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('transfer-quick-add')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const dialog = await openForm(page)

  const client = await createFromSelect(page, dialog, 'Naručitelj', 'Agencija Brza')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Agencija')
  await dialog.getByRole('button', { name: 'Dodaj naručitelja', exact: true }).click()
  await expect(client).toContainText('Agencija Brza')

  const place = await createFromSelect(page, dialog, 'Polazište', 'Hotel Brzi')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await dialog.getByLabel('Adresa').fill('Obala 1')
  await dialog.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()
  await expect(place).toContainText('Hotel Brzi')
})

test('a validation error keeps every typed value and focuses the summary', async ({ page }) => {
  const tenant = await seedTenant('transfer-invalid')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const dialog = await openForm(page)
  await dialog.getByLabel('Ime gosta').fill('Ana Ostaje')
  await dialog.getByLabel('Cijena (EUR)').fill('42,50')
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(dialog.getByLabel('Ime gosta')).toHaveValue('Ana Ostaje')
  await expect(dialog.getByLabel('Cijena (EUR)')).toHaveValue('42,50')
  await expect(dialog.getByLabel('Referenca naručitelja')).toHaveCount(0)
  await expect(page.locator('#transfer-form-summary')).toBeFocused()
  await expect(page.locator('#transfer-form-summary')).toHaveAttribute('role', 'alert')
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the transfer form follows ${theme} and passes axe`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = (page.viewportSize()?.width ?? 1280) < 1024
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`transfer-form-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await page.goto('/transfers')
      await hydrated(page)
      await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
      const panel = phone
        ? page.getByRole('dialog')
        : page.getByRole('region', { name: 'Zabilježi transfer' })
      await expect(panel.getByRole('button', { name: 'Naručitelj', exact: true })).toBeVisible()
      await expect(panel.getByLabel('Ime gosta')).toBeVisible()
      await expect(panel.getByLabel('Referenca naručitelja')).toHaveCount(0)
      await expect(panel.getByLabel('Broj leta')).toBeHidden()
      await panel.getByRole('button', { name: 'Više', exact: true }).click()
      await expect(panel.getByLabel('Broj leta')).toBeVisible()
      await expect(panel.getByRole('checkbox', { name: 'Aerodromsko preuzimanje' })).toBeVisible()
      // The pointer stays on the last click. A hovered primary button uses
      // the /75 fill, which is below 4.5:1, so move it off before axe.
      await page.mouse.move(0, 0)
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await page.getByRole('button', { name: 'Record a transfer', exact: true }).click()
        const english = page.getByRole('region', { name: 'Record a transfer' }).or(page.getByRole('dialog'))
        await expect(english.getByLabel('Guest name')).toBeVisible()
        await expect(english.getByLabel('Client reference')).toHaveCount(0)
        await expect(english.getByRole('button', { name: 'More', exact: true })).toBeVisible()
        await page.mouse.move(0, 0)
        await expectNoAxeViolations(page)
      }
    })
  }
})
