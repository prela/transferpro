import type { Locator, Page } from '@playwright/test'
import pg from 'pg'
import { operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedMembership, seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, openListbox, openUserMenu, useTheme } from './fixtures/ui'

/**
 * A frozen tab keeps the company it was opened for. A save after another
 * tab has switched is refused, the message is announced, and the draft
 * stays under the original person and company (issue #506).
 */

const message = 'Aktivna tvrtka promijenjena je u drugoj kartici. Zaslon se ponovno učitava u aktivnu tvrtku.'

async function blockSwitchSignals(page: Page) {
  await page.addInitScript(() => {
    const Native = window.BroadcastChannel
    function SilentChannel(name: string) {
      const channel = new Native(name)
      if (name !== 'transferpro-tenant-switch')
        return channel
      return new Proxy(channel, {
        get(target, prop, receiver) {
          if (prop === 'addEventListener')
            return () => undefined
          return Reflect.get(target, prop, receiver)
        },
      })
    }
    window.BroadcastChannel = SilentChannel as unknown as typeof BroadcastChannel
    window.addEventListener('storage', (event) => {
      if (event.key === 'transferpro-tenant-switch')
        event.stopImmediatePropagation()
    }, true)
  })
}

async function signInToGate(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(email)
  await page.getByLabel('Lozinka').fill(password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
}

async function chooseCompany(page: Page, name: string, role: string) {
  await page.getByRole('button', { name: `${name}, ${role}`, exact: true }).click()
}

async function switchCompany(page: Page, from: string, to: string, role: string) {
  await hydrated(page)
  const menu = await openUserMenu(page, from)
  await menu.getByRole('menuitem', { name: `${to}, ${role}`, exact: true }).click()
  await expect(page.getByRole('button', { name: to, exact: true })).toBeVisible()
  await hydrated(page)
}

async function created(page: Page, path: string, data: unknown): Promise<void> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
}

async function chooseMenu(page: Page, dialog: Locator, field: string, option: string) {
  const listbox = await openListbox(page, dialog.getByRole('button', { name: field, exact: true }))
  await listbox.getByRole('option', { name: option, exact: true }).click()
}

async function openTransfer(page: Page) {
  await page.goto('/transfers')
  await hydrated(page)
  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('desktop', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`a stale transfer save reloads into the active company in ${theme}`, async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: 1280, height: 800 })
      await refuseStaleTransfer(page, theme, testInfo.project.name)
    })
  }
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`a stale transfer save reloads into the active company on a phone in ${theme} @phone`, async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: 390, height: 844 })
      await refuseStaleTransfer(page, theme, testInfo.project.name)
    })
  }
})

async function refuseStaleTransfer(page: Page, theme: 'light' | 'dark', project: string) {
  const office = await seedTenant(`changed-transfer-${project}-${theme}`)
  const other = await seedTenant(`changed-other-${project}-${theme}`)
  await seedMembership(other.tenantId, office.adminEmail, 'dispatcher')
  await useTheme(page, theme)
  await blockSwitchSignals(page)
  await signInToGate(page, office.adminEmail, office.password)
  await chooseCompany(page, office.name, 'Administrator')
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()

  await created(page, '/api/clients', { name: 'Agencija Zora', kind: 'agency' })
  await created(page, '/api/locations', { name: 'Polazak Zora', kind: 'airport' })
  await created(page, '/api/locations', { name: 'Dolazak Zora', kind: 'hotel' })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const openedFor = await page.evaluate(async () => {
    const session = await fetch('/api/session').then(response => response.json()) as { tenantId: string, userId: string }
    return session
  })

  const dialog = await openTransfer(page)
  await chooseMenu(page, dialog, 'Naručitelj', 'Agencija Zora')
  await chooseMenu(page, dialog, 'Polazište', 'Polazak Zora')
  await chooseMenu(page, dialog, 'Odredište', 'Dolazak Zora')
  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await dialog.getByLabel('Ime gosta').fill('Ana Skica')
  await dialog.getByLabel('Cijena (EUR)').fill('18')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('transferpro-transfer-draft:') && localStorage.getItem(key)?.includes('Ana Skica')))).toBe(true)

  const otherTab = await page.context().newPage()
  await otherTab.goto('/')
  await hydrated(otherTab)
  await switchCompany(otherTab, office.name, other.name, 'Dispečer')

  const posted: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/transfers')
      posted.push(request.postData() ?? '')
  })
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  const alert = page.getByRole('alert').filter({ hasText: message })
  await expect(alert).toBeVisible()
  expect(posted.join('\n')).toContain(openedFor.tenantId)
  expect(posted.join('\n')).toContain('Ana Skica')
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible()
  await expect(page.getByRole('button', { name: other.name, exact: true })).toBeVisible()
  await expectNoAxeViolations(page)

  const draft = await page.evaluate(() => Object.entries(localStorage)
    .filter(([key, value]) => key.startsWith('transferpro-transfer-draft:') && value.includes('Ana Skica'))
    .map(([key]) => key))
  expect(draft).toEqual([`transferpro-transfer-draft:${openedFor.userId}:${openedFor.tenantId}`])
  await otherTab.close()
}

test('a stale client save is refused the same way', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  const office = await seedTenant(`changed-client-${testInfo.project.name}`)
  const other = await seedTenant(`changed-client-other-${testInfo.project.name}`)
  await seedMembership(other.tenantId, office.adminEmail, 'dispatcher')
  await useTheme(page, 'light')
  await blockSwitchSignals(page)
  await signInToGate(page, office.adminEmail, office.password)
  await chooseCompany(page, office.name, 'Administrator')
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()
  await created(page, '/api/clients', { name: 'Agencija Stara', kind: 'agency' })
  await page.goto('/clients')
  await hydrated(page)
  await page.getByRole('button', { name: 'Agencija Stara', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill('Agencija Nova')

  const otherTab = await page.context().newPage()
  await otherTab.goto('/')
  await hydrated(otherTab)
  await switchCompany(otherTab, office.name, other.name, 'Dispečer')

  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible()
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('alert').filter({ hasText: message })).toBeVisible()
  await expectNoAxeViolations(page)
  const owner = new pg.Pool({ connectionString: process.env.DATABASE_MIGRATE_URL, max: 1 })
  try {
    const original = await owner.query<{ name: string }>(
      'select name from app.clients where tenant_id = $1 order by name',
      [office.tenantId],
    )
    const active = await owner.query<{ name: string }>(
      'select name from app.clients where tenant_id = $1 order by name',
      [other.tenantId],
    )
    expect(original.rows.map(row => row.name)).toEqual(['Agencija Stara'])
    expect(active.rows.map(row => row.name)).toEqual([])
  }
  finally {
    await owner.end()
  }
  await otherTab.close()
})
