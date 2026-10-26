import type { Page } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, openAudit, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Contact persons on the Client card (ADR-0049). The phone project runs this
 * block. The desktop project runs it beside the table.
 */

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

function card(page: Page, phone: boolean, name: string) {
  return page.getByRole(phone ? 'dialog' : 'region', { name })
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
  test('the office adds, corrects, and removes a contact person in Croatian', async ({ page }) => {
    test.setTimeout(90_000)
    const phone = isPhone(page)
    if (!phone)
      await page.setViewportSize({ width: 1440, height: 900 })
    const tenant = await seedTenant('contacts-hr')
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await page.goto('/clients')
    await hydrated(page)
    await addClient(page, phone, 'Hotel Jadran', 'Hotel')

    await page.getByRole('button', { name: 'Hotel Jadran', exact: true }).click()
    const panel = card(page, phone, 'Hotel Jadran')
    await panel.getByRole('tab', { name: 'Kontakti' }).click()
    await expect(panel.getByText('Nema kontakt osoba.')).toBeVisible()

    await panel.getByRole('button', { name: 'Dodaj kontakt osobu', exact: true }).click()
    const form = panel.locator('#contact-person-form')
    await form.getByRole('button', { name: 'Dodaj kontakt osobu', exact: true }).click()
    // The name and the missing phone are both refused on the first submit.
    await expect(form.getByText('Unesite ime.')).toBeVisible()
    await expect(form.getByText('Unesite telefon, e-poštu ili oboje.')).toBeVisible()

    await form.getByLabel('Ime').fill('Ana Booking')
    await form.getByRole('button', { name: 'Dodaj kontakt osobu', exact: true }).click()
    await expect(form.getByText('Unesite ime.')).toHaveCount(0)
    await expect(form.getByText('Unesite telefon, e-poštu ili oboje.')).toBeVisible()

    await form.getByLabel('Uloga').fill('booking')
    await form.getByLabel('Telefon').fill('+385911110364')
    await form.getByLabel('E-pošta').fill('booking@example.test')
    await form.getByRole('button', { name: 'Dodaj kontakt osobu', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(panel.getByRole('button', { name: 'Ana Booking', exact: true })).toBeVisible()
    await expect(panel.getByText('booking', { exact: true })).toBeVisible()
    await expect(panel.getByRole('link', { name: '+385911110364' })).toHaveAttribute('href', 'tel:+385911110364')
    await expect(panel.getByRole('link', { name: 'booking@example.test' })).toHaveAttribute('href', 'mailto:booking@example.test')
    await expectNoAxeViolations(page)

    await panel.getByRole('button', { name: 'Ana Booking', exact: true }).click()
    await form.getByLabel('Ime').fill('Iva Accounts')
    await form.getByRole('button', { name: 'Spremi', exact: true }).click()
    await expect(form).toBeHidden()
    await expect(panel.getByRole('button', { name: 'Iva Accounts', exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Ana Booking', exact: true })).toHaveCount(0)

    await panel.getByRole('button', { name: 'Ukloni Iva Accounts', exact: true }).click()
    const confirm = page.getByRole('dialog', { name: 'Ukloni' })
    await expect(confirm).toContainText('Ukloniti ovu kontakt osobu? Više se ne prikazuje.')
    await confirm.getByRole('button', { name: 'Odustani', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(panel.getByRole('button', { name: 'Iva Accounts', exact: true })).toBeVisible()

    await panel.getByRole('button', { name: 'Ukloni Iva Accounts', exact: true }).click()
    await confirm.getByRole('button', { name: 'Ukloni', exact: true }).click()
    await expect(confirm).toBeHidden()
    await expect(panel.getByText('Nema kontakt osoba.')).toBeVisible()
    await expect(panel.getByRole('link', { name: '+385911110364' })).toHaveCount(0)

    // The Client list is unchanged: the card's contacts are not a search column.
    await panel.getByRole('button', { name: 'Zatvori', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Hotel Jadran', exact: true })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Traži' }).fill('Iva')
    await expect(page.getByRole('button', { name: 'Hotel Jadran', exact: true })).toHaveCount(0)

    if (!phone) {
      await openAudit(page)
      await expect(page.getByRole('cell', { name: 'Kontakt osoba dodana', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Kontakt osoba ispravljena', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Kontakt osoba uklonjena', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Ime, Uloga, Telefon, E-pošta', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Ime', exact: true })).toBeVisible()
      await expect(page.getByRole('cell', { name: 'Uklonjeno', exact: true })).toBeVisible()
      await expect(page.getByText('Ana Booking')).toHaveCount(0)
      await expect(page.getByText('Iva Accounts')).toHaveCount(0)
      await expect(page.getByText('+385911110364')).toHaveCount(0)
      await expect(page.getByText('booking@example.test')).toHaveCount(0)
    }
  })

  test('an English contact person in the dark theme', async ({ page }) => {
    const phone = isPhone(page)
    if (!phone)
      await page.setViewportSize({ width: 1440, height: 900 })
    const tenant = await seedTenant('contacts-en')
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
    await panel.getByRole('tab', { name: 'Contacts' }).click()
    await expect(panel.getByText('No contact persons yet.')).toBeVisible()
    await panel.getByRole('button', { name: 'Add a contact person', exact: true }).click()
    const form = panel.locator('#contact-person-form')
    await form.getByLabel('Name').fill('Ana Booking')
    await form.getByLabel('Phone').fill('+385911110364')
    await form.getByRole('button', { name: 'Add contact person', exact: true }).click()
    await expect(panel.getByRole('link', { name: '+385911110364' })).toHaveAttribute('href', 'tel:+385911110364')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoAxeViolations(page)
  })
})
