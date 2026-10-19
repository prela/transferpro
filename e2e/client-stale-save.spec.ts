import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * A refused Client save names who changed the Client and when, then
 * Osvježi loads that change into the form (issue #335). Same message and
 * button as a refused Transfer save.
 */

const copy = {
  hr: {
    name: 'Ime',
    save: 'Spremi',
    refresh: 'Osvježi',
    by: (name: string, time: string) => `Promijenio ${name} u ${time}`,
  },
  en: {
    name: 'Name',
    save: 'Save',
    refresh: 'Refresh',
    by: (name: string, time: string) => `${name} changed it at ${time}`,
  },
} as const

type Locale = keyof typeof copy

async function addClient(page: Page, name: string): Promise<void> {
  const response = await page.request.post('/api/clients', { data: { name, kind: 'agency' } })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
}

async function openClient(page: Page, name: string, locale: Locale) {
  await page.goto('/clients')
  await page.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(copy[locale].name)).toHaveValue(name)
  return dialog
}

/** When the colleague's save landed, as the screen formats it. */
async function changedWhen(page: Page, name: string, locale: Locale): Promise<string> {
  const listed = await page.request.get('/api/clients')
  expect(listed.ok()).toBeTruthy()
  const clients = (await listed.json() as { clients: { name: string, changedAt: string | null }[] }).clients
  const changedAt = clients.find(client => client.name === name)?.changedAt
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
    test(`a refused Client save names who changed it, and Osvježi loads that change, in ${theme}`, async ({ browser, page }) => {
      test.setTimeout(120_000)
      const text = copy.hr
      const opened = 'Agencija Zastarjela'
      const typed = 'Agencija Moja'
      const saved = 'Agencija Spremljena'
      const tenant = await seedTenant(`client-stale-${theme}`)
      const colleague = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const { context, other } = await secondPage(browser, page, theme)
      try {
        await addClient(page, opened)
        await signIn(other, colleague.email, colleague.password, tenant.name)

        const dialog = await openClient(page, opened, 'hr')
        const otherDialog = await openClient(other, opened, 'hr')
        await dialog.getByLabel(text.name).fill(typed)
        await otherDialog.getByLabel(text.name).fill(saved)
        await otherDialog.getByRole('button', { name: text.save, exact: true }).click()
        await expect(otherDialog).toBeHidden()
        const when = await changedWhen(page, saved, 'hr')

        await dialog.getByRole('button', { name: text.save, exact: true }).click()
        const alert = dialog.getByRole('alert').filter({ hasText: text.by(colleague.name, when) })
        await expect(alert).toBeVisible()
        await expect(alert).toBeFocused()
        await expect(dialog.getByLabel(text.name)).toHaveValue(typed)
        await expectNoAxeViolations(page)

        await alert.getByRole('button', { name: text.refresh, exact: true }).click()
        await expect(dialog.getByLabel(text.name)).toHaveValue(saved)
        await expect(alert).toBeHidden()
        await dialog.getByLabel(text.name).fill(typed)
        await dialog.getByRole('button', { name: text.save, exact: true }).click()
        await expect(dialog).toBeHidden()
        await expect(page.getByRole('button', { name: typed, exact: true })).toBeVisible()
      }
      finally {
        await context.close()
      }
    })
  }
})

test('the refused Client save is in English', async ({ browser, page }) => {
  test.setTimeout(120_000)
  const text = copy.en
  const opened = 'Client Stale'
  const saved = 'Client Saved'
  const tenant = await seedTenant('client-stale-en')
  const colleague = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await switchLocale(page, 'en')
  const { context, other } = await secondPage(browser, page, 'light')
  try {
    await addClient(page, opened)
    await signIn(other, colleague.email, colleague.password, tenant.name)

    const dialog = await openClient(page, opened, 'en')
    const otherDialog = await openClient(other, opened, 'hr')
    await dialog.getByLabel(text.name).fill('Client Typed')
    await otherDialog.getByLabel(copy.hr.name).fill(saved)
    await otherDialog.getByRole('button', { name: copy.hr.save, exact: true }).click()
    await expect(otherDialog).toBeHidden()
    const when = await changedWhen(page, saved, 'en')

    await dialog.getByRole('button', { name: text.save, exact: true }).click()
    const alert = dialog.getByRole('alert').filter({ hasText: text.by(colleague.name, when) })
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('button', { name: text.refresh, exact: true })).toBeVisible()
    await expect(dialog.getByLabel(text.name)).toHaveValue('Client Typed')
  }
  finally {
    await context.close()
  }
})
