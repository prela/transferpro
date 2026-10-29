import type { Browser, Page } from '@playwright/test'
import { formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedMember, seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Billing details on the Client card (ADR-0051). Enter, correct, and a
 * refused save that names who and when. An individual Client has no tab.
 * The phone project runs this block. The desktop project runs it too.
 */

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

function card(page: Page, phone: boolean, name: string) {
  return page.getByRole(phone ? 'dialog' : 'region', { name })
}

const copy = {
  hr: {
    tab: 'Podaci za račun',
    legalName: 'Pravni naziv',
    country: 'Država',
    countryName: 'Hrvatska',
    oib: 'OIB',
    address: 'Adresa',
    save: 'Spremi',
    refresh: 'Osvježi',
    by: (name: string, time: string) => `Promijenio ${name} u ${time}`,
  },
  en: {
    tab: 'Billing details',
    legalName: 'Legal name',
    country: 'Country',
    countryName: 'Croatia',
    oib: 'OIB',
    address: 'Address',
    save: 'Save',
    refresh: 'Refresh',
    by: (name: string, time: string) => `${name} changed it at ${time}`,
  },
} as const

type Locale = keyof typeof copy

async function addClient(page: Page, name: string, kind: 'hotel' | 'individual') {
  const response = await page.request.post('/api/clients', { data: { name, kind } })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
}

async function openClient(page: Page, phone: boolean, name: string) {
  await page.goto('/clients')
  await hydrated(page)
  await page.getByRole('button', { name, exact: true }).click()
  return card(page, phone, name)
}

async function fillBilling(page: Page, panel: ReturnType<typeof card>, locale: Locale, legalName: string, address: string) {
  const text = copy[locale]
  const form = panel.locator('#client-billing-form')
  await form.getByLabel(text.legalName).fill(legalName)
  // The country control is a button. Its list is virtual, so the search
  // narrows it to the one country before the option is on screen.
  const country = form.getByRole('button', { name: text.country })
  await country.click()
  await page.getByRole('combobox', { name: text.country }).fill(text.countryName)
  await page.getByRole('option', { name: text.countryName, exact: true }).click()
  await expect(country).toContainText(text.countryName)
  await form.getByLabel(text.oib).fill('12345678903')
  await form.getByLabel(text.address).fill(address)
  return form
}

/** When the colleague's save landed, as the screen formats it. */
async function changedWhen(page: Page, clientName: string, locale: Locale): Promise<string> {
  const listed = await page.request.get('/api/clients')
  expect(listed.ok()).toBeTruthy()
  const clients = (await listed.json() as { clients: { name: string, id: string }[] }).clients
  const clientId = clients.find(client => client.name === clientName)?.id
  expect(clientId).toEqual(expect.any(String))
  const billing = await page.request.get(`/api/clients/${clientId}/billing-details`)
  expect(billing.ok()).toBeTruthy()
  const changedAt = (await billing.json() as { changedAt: string | null }).changedAt
  expect(changedAt).toEqual(expect.any(String))
  return formatInstant(new Date(changedAt!), 'Europe/Zagreb', locale)
}

async function secondPage(browser: Browser, page: Page, theme: 'light' | 'dark') {
  const baseURL = test.info().project.use.baseURL
  if (baseURL === undefined)
    throw new Error('Playwright baseURL is required.')
  const context = await browser.newContext({
    baseURL,
    locale: 'hr-HR',
    viewport: page.viewportSize() ?? { width: 1280, height: 720 },
    colorScheme: theme,
  })
  const other = await context.newPage()
  await useTheme(other, theme)
  return { context, other }
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`enter, correct, and refuse a stale billing save in ${theme}`, async ({ browser, page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const text = copy.hr
      const clientName = `Hotel Račun ${theme}`
      const opened = 'Jadran turizam d.o.o.'
      const typed = 'Jadran turizam j.d.o.o.'
      const saved = 'Jadran turizam spremljen d.o.o.'
      const address = 'Obala 1, Split'
      const corrected = 'Obala 2, Split'
      const tenant = await seedTenant(`billing-${theme}`)
      const colleague = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const { context, other } = await secondPage(browser, page, theme)
      try {
        await addClient(page, clientName, 'hotel')
        await addClient(page, 'Osoba Ana', 'individual')
        await signIn(other, colleague.email, colleague.password, tenant.name)

        const panel = await openClient(page, phone, clientName)
        await panel.getByRole('tab', { name: text.tab }).click()
        const form = await fillBilling(page, panel, 'hr', opened, address)
        await form.getByRole('button', { name: text.save, exact: true }).click()
        await expect(form.getByLabel(text.legalName)).toHaveValue(opened)

        await form.getByLabel(text.address).fill(corrected)
        await form.getByRole('button', { name: text.save, exact: true }).click()
        await expect(form.getByLabel(text.address)).toHaveValue(corrected)

        const otherPanel = await openClient(other, phone, clientName)
        await otherPanel.getByRole('tab', { name: text.tab }).click()
        const otherForm = otherPanel.locator('#client-billing-form')
        await expect(otherForm.getByLabel(text.legalName)).toHaveValue(opened)
        await otherForm.getByLabel(text.legalName).fill(saved)
        await otherForm.getByRole('button', { name: text.save, exact: true }).click()
        await expect(otherForm.getByLabel(text.legalName)).toHaveValue(saved)
        const when = await changedWhen(page, clientName, 'hr')

        await form.getByLabel(text.legalName).fill(typed)
        await form.getByRole('button', { name: text.save, exact: true }).click()
        const alert = panel.getByRole('alert').filter({ hasText: text.by(colleague.name, when) })
        await expect(alert).toBeVisible()
        await expect(alert).toBeFocused()
        await expect(form.getByLabel(text.legalName)).toHaveValue(typed)
        await expectNoAxeViolations(page)

        await alert.getByRole('button', { name: text.refresh, exact: true }).click()
        await expect(form.getByLabel(text.legalName)).toHaveValue(saved)
        await expect(alert).toBeHidden()

        if (theme === 'light') {
          await panel.getByRole('button', { name: 'Zatvori', exact: true }).click()
          const person = await openClient(page, phone, 'Osoba Ana')
          await expect(person.getByRole('tab', { name: text.tab })).toHaveCount(0)
        }
      }
      finally {
        await context.close()
      }
    })
  }
})

test('an English billing form in the dark theme', async ({ page }) => {
  const phone = isPhone(page)
  if (!phone)
    await page.setViewportSize({ width: 1440, height: 900 })
  const text = copy.en
  const tenant = await seedTenant('billing-en')
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await switchLocale(page, 'en')
  await page.goto('/clients')
  await hydrated(page)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await addClient(page, 'Hotel Jadran', 'hotel')
  const panel = await openClient(page, phone, 'Hotel Jadran')
  await panel.getByRole('tab', { name: text.tab }).click()
  const form = await fillBilling(page, panel, 'en', 'Jadran tourism ltd', 'Harbour 1, Split')
  await form.getByRole('button', { name: text.save, exact: true }).click()
  await expect(form.getByLabel(text.legalName)).toHaveValue('Jadran tourism ltd')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expectNoAxeViolations(page)
})
