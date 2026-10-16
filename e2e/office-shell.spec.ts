import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedTenant } from './fixtures/seed'
import { openUserMenu, signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

const sections = ['Početna', 'Transferi', 'Raspored', 'Naručitelji', 'Lokacije', 'Vozači', 'Vozila', 'Revizija', 'Postavke tvrtke'] as const

test('an admin moves through the sidebar, sees the current item, and the office page fills the panel', async ({ page }) => {
  const tenant = await seedTenant('shell-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav).toHaveCount(1)
  const linkText = (await nav.getByRole('link').allTextContents()).map(text => text.replace(/\d+/g, '').trim())
  expect(linkText).toEqual([...sections])
  await expect(nav.getByRole('link', { name: /^Početna, \d+$/ })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1, name: 'Početna' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expectOfficePanelWidth(page)

  const pages = [
    ['Transferi', 'Transferi'],
    ['Naručitelji', 'Naručitelji'],
    ['Lokacije', 'Lokacije'],
    ['Vozači', 'Vozači'],
    ['Vozila', 'Vozila'],
    ['Raspored', 'Raspored vozila'],
  ] as const
  for (const [link, heading] of pages) {
    await nav.getByRole('link', { name: link, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(nav.getByRole('link', { name: /^Početna, \d+$/ })).not.toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: link, exact: true })).toHaveAttribute('aria-current', 'page')
  }

  await nav.getByRole('link', { name: 'Naručitelji', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
  await expectOfficePanelWidth(page)
})

test('collapse is stored under transferpro-dashboard and the rail stays keyboard operable', async ({ page }) => {
  const tenant = await seedTenant('shell-collapse')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  const home = nav.getByRole('link', { name: /^Početna, \d+$/ })
  // Sign-in can leave focus on the page. Blur, then Tab from the top once the rail is up.
  await expect(home).toBeVisible()
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur()
  })
  await page.keyboard.press('Tab')
  await expect(home).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(nav.getByRole('link', { name: 'Transferi', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Transferi' })).toBeVisible()

  const collapse = page.getByRole('button', { name: 'Smanji bočnu traku', exact: true })
  await collapse.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Proširi bočnu traku', exact: true })).toBeFocused()

  const stored = await page.evaluate(() =>
    Object.entries(localStorage).filter(([key]) => key.startsWith('transferpro-dashboard')),
  )
  expect(stored.map(([key]) => key)).toEqual(['transferpro-dashboard-sidebar-shell'])
  expect(JSON.parse(stored[0]?.[1] ?? 'null')).toMatchObject({ collapsed: true })
  const cookies = await page.context().cookies()
  expect(cookies.filter(cookie => cookie.name.startsWith('transferpro-dashboard'))).toEqual([])

  const clients = nav.getByRole('link', { name: 'Naručitelji', exact: true })
  await expect(clients).toBeVisible()
  await clients.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
})

test('a phone viewport opens the rest of the navigation from Više', async ({ page }) => {
  const tenant = await seedTenant('shell-narrow')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.setViewportSize({ width: 390, height: 844 })

  const bar = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(bar.getByRole('link', { name: /^Početna, \d+$/ })).toBeVisible()
  await expect(bar.getByRole('link', { name: 'Transferi', exact: true })).toBeVisible()
  await expect(bar.getByRole('link', { name: 'Raspored', exact: true })).toBeVisible()
  await expect(bar.getByRole('link', { name: 'Naručitelji', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Novi transfer', exact: true })).toBeVisible()

  const more = page.getByRole('button', { name: 'Više', exact: true })
  await more.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog')
  await expect(panel).toBeVisible()
  const clients = panel.getByRole('link', { name: 'Naručitelji', exact: true })
  await expect(clients).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Revizija', exact: true })).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Postavke tvrtke', exact: true })).toBeVisible()
  await clients.click()
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Novi transfer', exact: true })).toHaveCount(0)
})

test('the sidebar is usable in light and dark, in Croatian and English', async ({ page }) => {
  const tenant = await seedTenant('shell-theme')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav.getByRole('link', { name: 'Naručitelji', exact: true })).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(nav.getByRole('link', { name: 'Vozači', exact: true })).toBeVisible()

  await switchLocale(page, 'en')
  const english = page.getByRole('navigation', { name: 'Sections' })
  await expect(english.getByRole('link', { name: /^Home, \d+$/ })).toHaveAttribute('aria-current', 'page')
  await expect(english.getByRole('link', { name: 'Clients', exact: true })).toBeVisible()
  await expect(english.getByRole('link', { name: 'Roster', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(english.getByRole('link', { name: 'Transfers', exact: true })).toBeVisible()
})

test('sign-in and invitation accept stay at most 28rem wide', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await expect(page.getByText('Dispečerski sustav za transfere', { exact: true })).toBeVisible()
  await expectNarrowColumn(page)

  await page.goto('/accept-invite')
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Prihvati pozivnicu' })).toBeVisible()
  await expectNarrowColumn(page)
})

test('driver home stays narrow and has no office sidebar', async ({ page }) => {
  const tenant = await seedTenant('shell-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
  await expectNarrowColumn(page)
})

test('an admin signs out from the user menu on home and on an office page, and the theme stays', async ({ page }) => {
  const tenant = await seedTenant('shell-menu-admin')
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const menu = await openUserMenu(page, tenant.name)
  await expect(menu.getByText(tenant.name, { exact: true })).toBeVisible()
  await expect(menu.getByText(tenant.adminEmail, { exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Moj profil', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'HR', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'EN', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Svijetla', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Tamna', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Prema uređaju', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Odjava', exact: true })).toBeVisible()
  await signOut(page)
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toHaveCount(0)
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')

  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Naručitelji', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
  const officeMenu = await openUserMenu(page, tenant.name)
  await expect(officeMenu.getByText(tenant.name, { exact: true })).toBeVisible()
  await signOut(page)
  await expect(page.getByText(tenant.name)).toHaveCount(0)
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')
})

test('a dispatcher signs out from the user menu on home and on an office page', async ({ page }) => {
  const tenant = await seedTenant('shell-menu-dispatcher')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Postavke tvrtke', exact: true })).toHaveCount(0)

  const menu = await openUserMenu(page, tenant.name)
  await expect(menu.getByText(tenant.name, { exact: true })).toBeVisible()
  await expect(menu.getByText(dispatcher.name)).toHaveCount(0)
  await signOut(page)

  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Raspored', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
  await openUserMenu(page, tenant.name)
  await signOut(page)
  await expect(page.getByText(tenant.name)).toHaveCount(0)
})

test('a failed sign-out from the user menu keeps the tenant and shows the failure', async ({ page }) => {
  const tenant = await seedTenant('shell-menu-fail')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Naručitelji', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
  await page.route('**/api/auth/sign-out', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })

  const menu = await openUserMenu(page, tenant.name)
  await menu.getByRole('menuitem', { name: 'Odjava', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
  await expect(page.getByRole('button', { name: tenant.name, exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Odjava nije uspjela. Pokušajte ponovno.' })).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('light')
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the office frame follows ${theme} density and passes axe`, async ({ page }) => {
      const tenant = await seedTenant(`shell-frame-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const phone = (page.viewportSize()?.width ?? 1280) < 1024

      if (phone) {
        const bar = page.getByRole('navigation', { name: 'Odjeljci' })
        await expect(bar.getByRole('link', { name: /^Početna, \d+$/ })).toBeVisible()
        await expect(bar.getByRole('link', { name: 'Naručitelji', exact: true })).toHaveCount(0)
        const fab = page.getByRole('button', { name: 'Novi transfer', exact: true })
        await expect(fab).toBeVisible()
        const fabBox = await fab.boundingBox()
        expect(fabBox?.height ?? 0).toBeGreaterThanOrEqual(44)
        await page.getByRole('button', { name: 'Više', exact: true }).click()
        await expect(page.getByRole('dialog').getByRole('link', { name: 'Postavke tvrtke', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
      }
      else {
        await expect(page.getByRole('button', { name: 'Više', exact: true })).toHaveCount(0)
        const add = page.getByRole('button', { name: 'Novi transfer', exact: true })
        await expect(add).toBeVisible()
        const box = await add.boundingBox()
        expect(box?.height ?? 0).toBeLessThan(40)
        await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByText('Operativa', { exact: true })).toBeVisible()
      }

      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        const nav = page.getByRole('navigation', { name: 'Sections' })
        if (phone)
          await expect(nav.getByRole('link', { name: /^Home, \d+$/ })).toBeVisible()
        else
          await expect(nav.getByRole('link', { name: 'Clients', exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})

test('the profile menu language group is operable from the keyboard', async ({ page }) => {
  const tenant = await seedTenant('shell-menu-locale-keys')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const trigger = page.getByRole('button', { name: tenant.name, exact: true })
  await trigger.focus()
  await page.keyboard.press('Enter')

  const hr = page.getByRole('menuitem', { name: 'HR', exact: true })
  const en = page.getByRole('menuitem', { name: 'EN', exact: true })
  await expect(hr).toBeVisible()
  for (let step = 0; step < 8 && !(await hr.evaluate(element => element === document.activeElement)); step++)
    await page.keyboard.press('ArrowDown')
  await expect(hr).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(en).toBeFocused()

  const saved = page.waitForRequest(request =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/locale',
  )
  await page.keyboard.press('Enter')
  expect((await saved).postDataJSON()).toEqual({ locale: 'en' })
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
})

test('the user menu is reachable and operable from the keyboard', async ({ page }) => {
  const tenant = await seedTenant('shell-menu-keys')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const trigger = page.getByRole('button', { name: tenant.name, exact: true })
  await expect(trigger).toBeVisible()
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur()
  })
  for (let step = 0; step < 12 && !(await trigger.evaluate(el => el === document.activeElement)); step++)
    await page.keyboard.press('Tab')
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')

  const item = page.getByRole('menuitem', { name: 'Odjava', exact: true })
  await expect(item).toBeVisible()
  for (let step = 0; step < 12 && !(await item.evaluate(el => el === document.activeElement)); step++)
    await page.keyboard.press('ArrowDown')
  await expect(item).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toHaveCount(0)
})

/** The page main fills the dashboard panel body, and that width is past 28rem. */
async function expectOfficePanelWidth(page: Page) {
  const box = await page.locator('main').evaluate((el) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    const main = el.getBoundingClientRect().width
    const parent = el.parentElement
    const pad = parent
      ? Number.parseFloat(getComputedStyle(parent).paddingLeft) + Number.parseFloat(getComputedStyle(parent).paddingRight)
      : 0
    const inner = parent ? parent.getBoundingClientRect().width - pad : main
    return { rem, main, inner }
  })
  expect(box.main).toBeGreaterThan(28 * box.rem)
  expect(Math.abs(box.main - box.inner)).toBeLessThan(2)
}

/** Sign-in, invitation accept, and Driver Home keep the old column. */
async function expectNarrowColumn(page: Page) {
  const box = await page.locator('main').evaluate((el) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return { rem, width: el.getBoundingClientRect().width }
  })
  expect(box.width).toBeLessThanOrEqual(28 * box.rem + 1)
}
