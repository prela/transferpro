import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, openAudit, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * The Client note on the Client card (ADR-0049). The phone project runs this
 * block. The desktop project runs it beside the table.
 */

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

function card(page: Page, phone: boolean, name: string) {
  return page.getByRole(phone ? 'dialog' : 'region', { name })
}

/** The button stays enabled before the request returns. Wait for the save itself. */
async function saveNote(page: Page, form: Locator, button: string) {
  const saved = page.waitForResponse(response =>
    response.request().method() === 'PUT' && response.url().endsWith('/note') && response.ok())
  await form.getByRole('button', { name: button, exact: true }).click()
  await saved
}

async function addClient(page: Page, phone: boolean, name: string, kind: string) {
  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  const panel = card(page, phone, 'Dodaj naručitelja')
  await panel.getByLabel('Ime').fill(name)
  await chooseOption(page, panel.getByRole('combobox', { name: 'Vrsta' }), kind)
  await panel.getByRole('button', { name: 'Dodaj naručitelja', exact: true }).click()
  await expect(panel).toBeHidden()
}

test.describe('@phone', () => {
  test('the office saves, corrects, and clears a Client note in Croatian', async ({ page }) => {
    test.setTimeout(90_000)
    const phone = isPhone(page)
    if (!phone)
      await page.setViewportSize({ width: 1440, height: 900 })
    const tenant = await seedTenant('note-hr')
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.goto('/clients')
    await hydrated(page)
    await addClient(page, phone, 'Hotel Jadran', 'Hotel')

    await page.getByRole('button', { name: 'Hotel Jadran', exact: true }).click()
    const panel = card(page, phone, 'Hotel Jadran')
    await panel.getByRole('tab', { name: 'Napomena' }).click()
    const form = panel.locator('#client-note-form')
    const field = form.getByLabel('Napomena')
    await expect(field).toHaveValue('')

    await field.fill(`${'A'.repeat(2001)}`)
    await form.getByRole('button', { name: 'Spremi', exact: true }).click()
    await expect(form.getByText('Napomena može imati najviše 2000 znakova.')).toBeVisible()

    const standing = 'Gosti se čekaju na izlazu.'
    await field.fill(standing)
    await saveNote(page, form, 'Spremi')
    await expect(field).toHaveValue(standing)
    await expectNoAxeViolations(page)

    const corrected = 'Plaćanje do 15. u mjesecu.'
    await field.fill(corrected)
    await saveNote(page, form, 'Spremi')
    await expect(field).toHaveValue(corrected)

    await field.fill('')
    await saveNote(page, form, 'Spremi')
    await expect(field).toHaveValue('')

    await panel.getByRole('button', { name: 'Zatvori', exact: true }).click()
    await expect(panel).toBeHidden()

    if (!phone) {
      await openAudit(page)
      await expect(page.getByRole('cell', { name: 'Napomena naručitelja spremljena', exact: true }).first()).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Napomena', exact: true }).first()).toBeVisible()
      await expect(page.getByText(standing)).toHaveCount(0)
      await expect(page.getByText(corrected)).toHaveCount(0)
    }
  })

  test('an English Client note in the dark theme', async ({ page }) => {
    const phone = isPhone(page)
    if (!phone)
      await page.setViewportSize({ width: 1440, height: 900 })
    const tenant = await seedTenant('note-en')
    await useTheme(page, 'dark')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await switchLocale(page, 'en')
    await page.goto('/clients')
    await hydrated(page)
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.getByRole('button', { name: '+ Add', exact: true }).click()
    const adding = card(page, phone, 'Add a client')
    await adding.getByLabel('Name').fill('Hotel Jadran')
    await chooseOption(page, adding.getByRole('combobox', { name: 'Kind' }), 'Hotel')
    await adding.getByRole('button', { name: 'Add client', exact: true }).click()
    await expect(adding).toBeHidden()

    await page.getByRole('button', { name: 'Hotel Jadran', exact: true }).click()
    const panel = card(page, phone, 'Hotel Jadran')
    await panel.getByRole('tab', { name: 'Note' }).click()
    const form = panel.locator('#client-note-form')
    await form.getByLabel('Note').fill('Meet guests at the exit.')
    await saveNote(page, form, 'Save')
    await expect(form.getByLabel('Note')).toHaveValue('Meet guests at the exit.')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoAxeViolations(page)
  })
})
