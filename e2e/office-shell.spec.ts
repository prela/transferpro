import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { openUserMenu, signIn, signOut, useTheme } from './fixtures/ui'

const sections = ['Početna', 'Transferi', 'Klijenti', 'Lokacije', 'Vozači', 'Vozila', 'Raspored'] as const

test('an admin moves through the sidebar, sees the current item, and the office page fills the panel', async ({ page }) => {
  const tenant = await seedTenant('shell-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav).toHaveCount(1)
  await expect(nav.getByRole('link')).toHaveText([...sections])
  await expect(nav.getByRole('link', { name: 'Početna', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
  await expect(page.getByText('Primjer vremena', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expectOfficePanelWidth(page)

  const pages = [
    ['Transferi', 'Transferi'],
    ['Klijenti', 'Klijenti'],
    ['Lokacije', 'Lokacije'],
    ['Vozači', 'Vozači'],
    ['Vozila', 'Vozila'],
    ['Raspored', 'Raspored vozila'],
  ] as const
  for (const [link, heading] of pages) {
    await nav.getByRole('link', { name: link, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Početna', exact: true })).not.toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('link', { name: link, exact: true })).toHaveAttribute('aria-current', 'page')
  }

  await nav.getByRole('link', { name: 'Klijenti', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await expectOfficePanelWidth(page)
})

test('collapse is stored under transferpro-dashboard and the rail stays keyboard operable', async ({ page }) => {
  const tenant = await seedTenant('shell-collapse')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  const home = nav.getByRole('link', { name: 'Početna', exact: true })
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

  const clients = nav.getByRole('link', { name: 'Klijenti', exact: true })
  await expect(clients).toBeVisible()
  await clients.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
})

test('a narrow viewport opens the sidebar as a slideover from the keyboard', async ({ page }) => {
  const tenant = await seedTenant('shell-narrow')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.setViewportSize({ width: 390, height: 844 })

  const open = page.getByRole('button', { name: 'Otvori bočnu traku', exact: true })
  await expect(open).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)

  await page.keyboard.press('Tab')
  await expect(open).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()

  const clients = page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Klijenti', exact: true })
  for (let step = 0; step < 8 && !(await clients.evaluate(el => el === document.activeElement)); step++)
    await page.keyboard.press('Tab')
  await expect(clients).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
})

test('the sidebar is usable in light and dark, in Croatian and English', async ({ page }) => {
  const tenant = await seedTenant('shell-theme')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav.getByRole('link', { name: 'Klijenti', exact: true })).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  await page.getByRole('button', { name: 'Tamna tema', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(nav.getByRole('link', { name: 'Vozači', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'English', exact: true }).click()
  const english = page.getByRole('navigation', { name: 'Sections' })
  await expect(english.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(english.getByRole('link', { name: 'Clients', exact: true })).toBeVisible()
  await expect(english.getByRole('link', { name: 'Roster', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await page.getByRole('button', { name: 'Light theme', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(english.getByRole('link', { name: 'Transfers', exact: true })).toBeVisible()
})

test('sign-in and invitation accept stay at most 28rem wide', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
  await expectNarrowColumn(page)

  await page.goto('/accept-invite')
  await expect(page.getByRole('heading', { level: 1, name: 'Prihvati pozivnicu' })).toBeVisible()
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
  await expect(menu.getByRole('menuitem')).toHaveCount(1)
  await expect(menu.getByRole('menuitem', { name: 'Odjava', exact: true })).toBeVisible()
  await expect(menu.getByText(tenant.adminName)).toHaveCount(0)
  await expect(menu.getByText(tenant.adminEmail)).toHaveCount(0)
  await signOut(page)
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toHaveCount(0)
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')

  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Klijenti', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
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
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Klijenti', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await page.route('**/api/auth/sign-out', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })

  const menu = await openUserMenu(page, tenant.name)
  await menu.getByRole('menuitem', { name: 'Odjava', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()
  await expect(page.getByRole('button', { name: tenant.name, exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Odjava nije uspjela. Pokušajte ponovno.' })).toBeVisible()
  await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('light')
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
  for (let step = 0; step < 4 && !(await item.evaluate(el => el === document.activeElement)); step++)
    await page.keyboard.press('ArrowDown')
  await expect(item).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
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
