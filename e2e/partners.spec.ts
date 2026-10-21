import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { openAudit, signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

const name = 'Mora Prijevoz'
const nextName = 'Jug Prijevoz'
const phone = '+385911110099'
const nextPhone = '+385921110088'
const email = 'mora.partner@example.test'
const note = 'Stoji na Čilipima'

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

async function openPartners(page: Page, label: string) {
  const link = page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: label, exact: true })
  if (await link.isVisible()) {
    await link.click()
    return
  }
  const more = page.getByRole('button', { name: 'Više', exact: true })
  await more.click()
  await page.getByRole('dialog').getByRole('link', { name: label, exact: true }).click()
}

test('admin adds a subcontractor, corrects it, archives it, and restores it', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('partners-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Podizvođači' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Podizvođači' })).toBeVisible()
  await expect(page.getByText('Još nema podizvođača. Dodajte prvog.')).toBeVisible()
  await expect(page.getByLabel('Prikaži arhivirano')).toBeVisible()

  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { level: 1, name: 'Subcontractors' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible()
  await expect(page.getByLabel('Show archived')).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Add', exact: true })).toBeVisible()
  await expect(page.getByText('No subcontractors yet. Add the first one.')).toBeVisible()
  await page.getByRole('button', { name: '+ Add', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(' ')
  await dialog.getByRole('button', { name: 'Add subcontractor', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Enter a name.')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()

  await switchLocale(page, 'hr')
  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Naziv').fill(' ')
  await dialog.getByRole('button', { name: 'Dodaj podizvođača', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Unesite naziv.')
  await dialog.getByLabel('Naziv').fill(name)
  await dialog.getByLabel('Telefon').fill(phone)
  await dialog.getByLabel('E-pošta').fill(email)
  await dialog.getByLabel('Napomena').fill(note)
  await dialog.getByRole('button', { name: 'Dodaj podizvođača', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${name}` })).toBeVisible()
  await expect(page.getByRole('cell', { name: phone })).toBeVisible()
  await expect(page.getByRole('cell', { name: email })).toBeVisible()

  await page.getByRole('button', { name, exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'Podaci' })).toBeVisible()
  await dialog.getByLabel('Naziv').fill(nextName)
  await dialog.getByLabel('Telefon').fill(nextPhone)
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${nextName}` })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextPhone })).toBeVisible()

  await page.getByRole('searchbox', { name: 'Traži' }).fill('Čilipima')
  await expect(page.getByRole('button', { name: nextName, exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Traži' }).fill('nema-ovog')
  await expect(page.getByText('Nema zapisa za ovu pretragu. Promijenite tekst ili dodajte novi.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Traži' }).fill('')

  await page.getByRole('button', { name: `Radnje: ${nextName}` }).click()
  await page.getByRole('menuitem', { name: 'Arhiviraj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: nextName, exact: true })).toBeVisible()

  await page.getByRole('button', { name: `Radnje: ${nextName}` }).click()
  await page.getByRole('menuitem', { name: 'Arhiviraj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByText(nextName)).toBeVisible()
  await dialog.getByRole('button', { name: 'Arhiviraj', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${nextName}` })).toHaveCount(0)
  await expect(page.getByText('Još nema podizvođača. Dodajte prvog.')).toBeVisible()

  await page.getByLabel('Prikaži arhivirano').check()
  await expect(page.getByRole('button', { name: `Radnje: ${nextName}` })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Arhivirano' })).toBeVisible()
  await page.getByRole('button', { name: nextName, exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'Podaci' })).toBeVisible()
  await expect(dialog.getByLabel('Naziv')).toBeDisabled()
  await expect(dialog.getByLabel('Telefon')).toBeDisabled()
  await expect(dialog.getByLabel('E-pošta')).toBeDisabled()
  await expect(dialog.getByLabel('Napomena')).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Spremi', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Vrati', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByLabel('Prikaži arhivirano').uncheck()
  await expect(page.getByRole('button', { name: `Radnje: ${nextName}` })).toBeVisible()

  await openAudit(page)
  await expect(page.getByRole('cell', { name: 'Podizvođač dodan', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Podizvođač ispravljen', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Podizvođač arhiviran', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Podizvođač vraćen', exact: true })).toBeVisible()
  await expect(page.getByText(name)).toHaveCount(0)
  await expect(page.getByText(nextName)).toHaveCount(0)
  await expect(page.getByText(phone)).toHaveCount(0)
  await expect(page.getByText(nextPhone)).toHaveCount(0)
  await expect(page.getByText(email)).toHaveCount(0)
  await expect(page.getByText(note)).toHaveCount(0)

  await page.getByRole('link', { name: 'Podizvođači' }).click()
  await expect(page).toHaveURL(/\/partners$/)
  await page.reload()
  await expect(page.getByRole('button', { name: nextName, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextPhone })).toBeVisible()

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expectNoAxeViolations(page)
  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expectNoAxeViolations(page)
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`subcontractors follow the catalog pattern in ${theme}`, async ({ page }) => {
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`partners-pattern-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await openPartners(page, 'Podizvođači')
      await expect(page.getByRole('heading', { level: 1, name: 'Podizvođači' })).toBeVisible()
      await expect(page.getByRole('searchbox', { name: 'Traži' })).toBeVisible()
      await expect(page.getByLabel('Prikaži arhivirano')).toBeVisible()
      await expect(page.getByText('Još nema podizvođača. Dodajte prvog.')).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      const panel = page.getByRole(phone ? 'dialog' : 'region', { name: 'Dodaj podizvođača' })
      await expect(panel.getByLabel('Naziv')).toBeVisible()
      await expectNoAxeViolations(page)
      await panel.getByRole('button', { name: 'Odustani', exact: true }).click()
      await expect(panel).toBeHidden()
    })
  }
})
