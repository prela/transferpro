import type { Page } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedMembership, seedTenant } from './fixtures/seed'
import { hydrated, openUserMenu, signOut, switchTheme, useTheme } from './fixtures/ui'

/**
 * The profile menu switches company without signing out (ADR-0056).
 * The unfinished Transfer stays with the company it was typed in.
 */

async function chooseCompany(page: Page, name: string, role: string) {
  await page.getByRole('button', { name: `${name}, ${role}`, exact: true }).click()
}

async function signInToGate(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(email)
  await page.getByLabel('Lozinka').fill(password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
}

async function switchCompany(page: Page, from: string, to: string, role: string) {
  await hydrated(page)
  const menu = await openUserMenu(page, from)
  await menu.getByRole('menuitem', { name: `${to}, ${role}`, exact: true }).click()
  await expect(page.getByRole('button', { name: to, exact: true })).toBeVisible()
  await hydrated(page)
}

async function storedDrafts(page: Page): Promise<string> {
  return page.evaluate(() => Object.entries(localStorage)
    .filter(([key]) => key.startsWith('transferpro-transfer-draft:'))
    .map(([, value]) => value)
    .join('\n'))
}

/**
 * Opens the new-Transfer form from Home or from the board.
 * A stored draft is what the form shows. Home's Novi transfer is the
 * control that is on screen after a company switch.
 */
async function openTransfer(page: Page) {
  await hydrated(page)
  const dialog = page.getByRole('dialog')
  if (await dialog.isVisible())
    return dialog
  const record = page.getByRole('button', { name: 'Zabilježi transfer', exact: true })
  if (await record.isVisible())
    await record.click()
  else
    await page.getByRole('button', { name: 'Novi transfer', exact: true }).click()
  await expect(dialog).toBeVisible()
  return dialog
}

/** Odustani keeps the draft. The open form covers the profile menu. */
async function closeTransfer(page: Page) {
  await page.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test('switching company keeps each draft, and another tab drops the company that was left', async ({ page }) => {
  test.setTimeout(180_000)
  const office = await seedTenant('switch-office')
  const other = await seedTenant('switch-other')
  await seedMembership(other.tenantId, office.adminEmail, 'dispatcher')

  await useTheme(page, 'light')
  await signInToGate(page, office.adminEmail, office.password)
  await chooseCompany(page, office.name, 'Administrator')
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()
  const trigger = page.getByRole('button', { name: office.name, exact: true })
  await expect(trigger).toContainText(office.name)
  await expect(page.locator('main').getByText(office.name, { exact: true })).toHaveCount(0)
  await page.getByRole('heading', { level: 1, name: 'Početna', exact: true }).click()
  await expectNoAxeViolations(page)

  await switchTheme(page, 'dark')
  await expect(page.getByRole('button', { name: office.name, exact: true })).toContainText(office.name)
  await page.getByRole('heading', { level: 1, name: 'Početna', exact: true }).click()
  await expectNoAxeViolations(page)

  const dialog = await openTransfer(page)
  await dialog.getByLabel('Ime gosta').fill('Ana Skica')
  await expect.poll(() => storedDrafts(page)).toContain('Ana Skica')
  await closeTransfer(page)

  const otherTab = await page.context().newPage()
  await otherTab.goto('/transfers')
  await hydrated(otherTab)
  await expect(otherTab.getByRole('dialog').getByLabel('Ime gosta')).toHaveValue('Ana Skica')

  await switchCompany(page, office.name, other.name, 'Dispečer')
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Postavke tvrtke', exact: true })).toHaveCount(0)
  await expect(page.locator('main').getByText(other.name, { exact: true })).toHaveCount(0)
  await expect(otherTab).toHaveURL(/\/$/)
  await expect(otherTab.getByRole('button', { name: other.name, exact: true })).toBeVisible()
  await expect(otherTab.getByText('Ana Skica')).toHaveCount(0)
  await expect(otherTab.getByRole('heading', { name: 'Transferi', exact: true })).toHaveCount(0)
  await otherTab.close()

  const blank = await openTransfer(page)
  await expect(blank.getByText('Vraćen nedovršeni unos')).toHaveCount(0)
  await expect(blank.getByLabel('Ime gosta')).toHaveValue('')
  await expect(page.getByText('Ana Skica')).toHaveCount(0)
  const creates: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/transfers')
      creates.push(request.postData() ?? '')
  })
  await blank.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  expect(creates.join('\n')).not.toContain('Ana Skica')
  const storedForOther = await page.evaluate(async () => {
    const session = await fetch('/api/session').then(response => response.json()) as { tenantId: string }
    const ana = Object.entries(localStorage).find(([key, value]) =>
      key.startsWith('transferpro-transfer-draft:') && value.includes('Ana Skica'))
    return { tenantId: session.tenantId, key: ana?.[0] ?? '' }
  })
  expect(storedForOther.key).not.toBe('')
  expect(storedForOther.key.endsWith(storedForOther.tenantId)).toBe(false)
  await closeTransfer(page)

  await switchCompany(page, other.name, office.name, 'Administrator')
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Postavke tvrtke', exact: true })).toBeVisible()
  const restored = await openTransfer(page)
  await expect(restored.getByText('Vraćen nedovršeni unos')).toBeVisible()
  await expect(restored.getByLabel('Ime gosta')).toHaveValue('Ana Skica')
  await closeTransfer(page)

  await switchCompany(page, office.name, other.name, 'Dispečer')
  const second = await openTransfer(page)
  await second.getByLabel('Ime gosta').fill('Boris Skica')
  await expect.poll(() => storedDrafts(page)).toContain('Boris Skica')
  await closeTransfer(page)
  await signOut(page)
  await expect.poll(() => storedDrafts(page)).toContain('Ana Skica')
  await expect.poll(() => storedDrafts(page)).not.toContain('Boris Skica')

  await signInToGate(page, office.adminEmail, office.password)
  await chooseCompany(page, office.name, 'Administrator')
  const again = await openTransfer(page)
  await expect(again.getByLabel('Ime gosta')).toHaveValue('Ana Skica')
  await closeTransfer(page)
  await signOut(page)

  await signInToGate(page, office.adminEmail, office.password)
  await chooseCompany(page, other.name, 'Dispečer')
  const gone = await openTransfer(page)
  await expect(gone.getByText('Vraćen nedovršeni unos')).toHaveCount(0)
  await expect(gone.getByLabel('Ime gosta')).toHaveValue('')
})

test.describe('@phone', () => {
  test('the office phone shows the company name, and the driver header keeps it @phone', async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const office = await seedTenant('switch-phone-office')
    const driving = await seedTenant('switch-phone-driver')
    await seedMembership(driving.tenantId, office.adminEmail, 'driver')

    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme)
      await page.goto('/')
      if (theme === 'light') {
        await page.getByLabel('E-pošta').fill(office.adminEmail)
        await page.getByLabel('Lozinka').fill(office.password)
        await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
        await chooseCompany(page, office.name, 'Administrator')
      }
      await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: office.name, exact: true })).toContainText(office.name)
      await expect(page.locator('main').getByText(office.name, { exact: true })).toHaveCount(0)
      await page.getByRole('heading', { level: 1, name: 'Početna', exact: true }).click()
      await page.mouse.move(8, 700)
      await expectNoAxeViolations(page)
    }

    await page.getByRole('button', { name: 'Novi transfer', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByLabel('Ime gosta').fill('Ana Telefon')
    await expect.poll(() => storedDrafts(page)).toContain('Ana Telefon')
    await closeTransfer(page)

    await switchCompany(page, office.name, driving.name, 'Vozač')
    await expect(page.getByRole('heading', { level: 1, name: driving.name, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: driving.name, exact: true })).not.toContainText(driving.name)
    await expect(page.getByText('Ana Telefon')).toHaveCount(0)
    await page.getByRole('heading', { level: 1, name: driving.name, exact: true }).click()
    await page.mouse.move(8, 700)
    await expectNoAxeViolations(page)

    await switchTheme(page, 'light')
    await expect(page.getByRole('heading', { level: 1, name: driving.name, exact: true })).toBeVisible()
    await expectNoAxeViolations(page)

    await switchCompany(page, driving.name, office.name, 'Administrator')
    const restored = await openTransfer(page)
    await expect(restored.getByText('Vraćen nedovršeni unos')).toBeVisible()
    await expect(restored.getByLabel('Ime gosta')).toHaveValue('Ana Telefon')
    await closeTransfer(page)

    await switchCompany(page, office.name, driving.name, 'Vozač')
    await signOut(page)
    await expect.poll(() => storedDrafts(page)).toContain('Ana Telefon')
    await signInToGate(page, office.adminEmail, office.password)
    await chooseCompany(page, office.name, 'Administrator')
    const kept = await openTransfer(page)
    await expect(kept.getByLabel('Ime gosta')).toHaveValue('Ana Telefon')
  })
})
