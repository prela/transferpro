import type { Locator, Page } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedMember, seedSuperadmin, seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

/**
 * Shell skip link (issue #566, WCAG 2.4.1). The office and the platform
 * share the frame. The Driver's phone has its own header. Viewports come
 * from the Playwright projects: this file is tagged @phone so the phone
 * project runs it, and the desktop project runs the same cases wide.
 */

const SKIP_HR = 'Preskoči na sadržaj'
const SKIP_EN = 'Skip to content'

test.describe('@phone', () => {
  test('an admin skips the shell on the desktop and the phone, in both themes', async ({ page }) => {
    test.setTimeout(180_000)
    const tenant = await seedTenant('skip-admin')
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await hydrated(page)

    await exerciseSkip(page, SKIP_HR, tenant.name)
    await expectNoAxeViolations(page)
    await switchTheme(page, 'dark')
    await exerciseSkip(page, SKIP_HR, tenant.name)
    await expectNoAxeViolations(page)

    await switchLocale(page, 'en')
    await exerciseSkip(page, SKIP_EN, tenant.name)
    await page.goto('/clients')
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
    await hydrated(page)
    await exerciseSkip(page, SKIP_EN, tenant.name)
  })

  test('a driver skips the phone header to the ride list, in both themes', async ({ page }) => {
    test.setTimeout(180_000)
    const tenant = await seedTenant('skip-driver')
    const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
    await useTheme(page, 'light')
    await signIn(page, driver.email, driver.password, tenant.name)
    await hydrated(page)

    await exerciseSkip(page, SKIP_HR, tenant.name)
    await expectNoAxeViolations(page)
    await switchTheme(page, 'dark')
    await exerciseSkip(page, SKIP_HR, tenant.name)
    await expectNoAxeViolations(page)

    await page.goto('/profile')
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await hydrated(page)
    await exerciseSkip(page, SKIP_HR, tenant.name)
    await switchLocale(page, 'en')
    await exerciseSkip(page, SKIP_EN, tenant.name)
  })

  test('a superadmin skips the platform shell in both themes and in English', async ({ page }) => {
    test.setTimeout(180_000)
    await seedTenant('skip-platform')
    const owner = await seedSuperadmin('skip-platform')
    await useTheme(page, 'light')
    await page.goto('/')
    await page.getByLabel('E-pošta').fill(owner.email)
    await page.getByLabel('Lozinka').fill(owner.password)
    await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toBeVisible()
    await hydrated(page)

    await exerciseSkip(page, SKIP_HR, owner.name)
    await expectNoAxeViolations(page)

    await page.getByRole('button', { name: owner.name, exact: true }).click()
    await page.getByRole('menuitem', { name: 'Tamna', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.getByRole('menu')).toBeHidden()
    await exerciseSkip(page, SKIP_HR, owner.name)
    await expectNoAxeViolations(page)

    await page.getByRole('button', { name: owner.name, exact: true }).click()
    await page.getByRole('menuitem', { name: 'EN', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible()
    await expect(page.getByRole('menu')).toBeHidden()
    await exerciseSkip(page, SKIP_EN, owner.name)
  })
})

test('a dispatcher skips the same office shell', async ({ page }) => {
  const tenant = await seedTenant('skip-dispatcher')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await useTheme(page, 'light')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await hydrated(page)
  await exerciseSkip(page, SKIP_HR, tenant.name)
  await expectNoAxeViolations(page)
})

test('sign-in has no shell skip link', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await expect(page.getByRole('link', { name: SKIP_HR, exact: true })).toHaveCount(0)
})

/**
 * Prove the skip link is the first stop and that it lands in the main.
 * A menu or locale click leaves Chrome's tab start on that control, so
 * the next Tab would continue there. Focusing the document root sends
 * the following Tab back to the top of the screen.
 */
async function exerciseSkip(page: Page, name: string, chromeName: string) {
  await focusFromTop(page)
  const skip = page.getByRole('link', { name, exact: true })
  await expect(skip).toHaveCount(1)
  expect(await clipped(skip)).toBe(true)

  await page.keyboard.press('Tab')
  await expect(skip).toBeFocused()
  await expectVisibleAndClear(page, skip)
  await expectTokenColors(skip)

  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  expect(new URL(page.url()).hash).toBe('')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: chromeName, exact: true })).not.toBeFocused()
  expect(await focusIsInsideMain(page)).toBe(true)
}

async function focusFromTop(page: Page) {
  await page.evaluate(() => {
    const root = document.documentElement
    const previous = root.getAttribute('tabindex')
    root.tabIndex = -1
    root.focus()
    if (previous === null)
      root.removeAttribute('tabindex')
    else
      root.setAttribute('tabindex', previous)
  })
}

/** The resting link is the one-pixel screen-reader clip, not a visible control. */
async function clipped(skip: Locator): Promise<boolean> {
  return skip.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width <= 1 && rect.height <= 1
  })
}

/**
 * Focused: on screen, not under the top bar, and clear of the phone bar
 * and the floating button (WCAG 2.4.11).
 */
async function expectVisibleAndClear(page: Page, skip: Locator) {
  const box = await skip.boundingBox()
  expect(box).not.toBeNull()
  if (!box)
    return
  expect(box.width).toBeGreaterThan(24)
  expect(box.height).toBeGreaterThan(24)
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (!viewport)
    return
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1)

  const uncovered = await skip.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return hit === element || (hit !== null && element.contains(hit))
  })
  expect(uncovered).toBe(true)

  const chrome = page.locator('nav.fixed, button.fixed')
  const count = await chrome.count()
  for (let index = 0; index < count; index += 1) {
    const item = chrome.nth(index)
    if (!await item.isVisible())
      continue
    const other = await item.boundingBox()
    if (!other)
      continue
    const overlaps = box.x < other.x + other.width
      && box.x + box.width > other.x
      && box.y < other.y + other.height
      && box.y + box.height > other.y
    expect(overlaps).toBe(false)
  }
}

/** The visible label uses the text and surface tokens ADR-0040 already measures. */
async function expectTokenColors(skip: Locator) {
  const same = await skip.evaluate((element) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--ui-text)'
    probe.style.backgroundColor = 'var(--ui-bg)'
    document.body.append(probe)
    const probeStyle = getComputedStyle(probe)
    const linkStyle = getComputedStyle(element)
    const matches = linkStyle.color === probeStyle.color
      && linkStyle.backgroundColor === probeStyle.backgroundColor
    probe.remove()
    return matches
  })
  expect(same).toBe(true)
}

async function focusIsInsideMain(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const active = document.activeElement
    const main = document.getElementById('main-content')
    return active instanceof HTMLElement
      && main !== null
      && active !== main
      && main.contains(active)
  })
}
