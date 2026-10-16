import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedSuperadmin, seedTenant } from './fixtures/seed'
import { hydrated, openUserMenu, signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

test('/settings opens company settings for an admin, and /profile for a dispatcher and a driver', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-open')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')

  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings\/tenant$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Postavke tvrtke' })).toBeVisible()
  const tabs = page.getByRole('navigation', { name: 'Postavke' })
  await expect(tabs.getByRole('link')).toHaveText(['Tvrtka', 'Članovi'])
  await expect(tabs.getByRole('link', { name: 'Profil', exact: true })).toHaveCount(0)
  await page.goto('/')
  await hydrated(page)
  await signOut(page)

  for (const member of [dispatcher, driver]) {
    await signIn(page, member.email, member.password, tenant.name)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Postavke' })).toHaveCount(0)
    await page.goto('/')
    await hydrated(page)
    await signOut(page)
  }
})

test('profile saves hr and en through POST /api/locale and the next screen uses that language', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-locale')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await hydrated(page)

  const english = page.waitForRequest(request =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/locale',
  )
  await page.getByRole('button', { name: 'English', exact: true }).click()
  expect((await english).postDataJSON()).toEqual({ locale: 'en' })
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Home', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Clients', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()

  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  await hydrated(page)
  const croatian = page.waitForRequest(request =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/locale',
  )
  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  expect((await croatian).postDataJSON()).toEqual({ locale: 'hr' })
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: /^Početna, \d+$/ })).toBeVisible()
  await page.getByRole('link', { name: 'Naručitelji', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
})

test('signed-in home keeps locale and theme in the profile menu, not as page buttons', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-no-chrome')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const menu = await openUserMenu(page, tenant.name)
  await expect(menu.getByRole('menuitem', { name: 'HR', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'EN', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Svijetla', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Tamna', exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Prema uređaju', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expectNoLocaleTheme(page)

  await page.getByRole('link', { name: 'Naručitelji', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Naručitelji' })).toBeVisible()
  await expectNoLocaleTheme(page)

  await page.goto('/settings/tenant')
  await expect(page.getByRole('heading', { level: 1, name: 'Postavke tvrtke' })).toBeVisible()
  await expectNoLocaleTheme(page)

  await signOut(page)
  await hydrated(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByText('Dispatch system for transfers', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dark', exact: true })).toBeVisible()
})

test('an admin, a dispatcher, and a driver save locale and theme on profile and the next screen uses that choice', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-roles')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')

  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await switchLocale(page, 'en')
  await page.goto('/clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  // Sign-out looks for the Croatian control, and the next Member starts from light.
  await switchLocale(page, 'hr')
  await switchTheme(page, 'light')
  await page.goto('/')
  await hydrated(page)
  await signOut(page)

  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await switchLocale(page, 'en')
  await page.goto('/clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  await switchLocale(page, 'hr')
  await switchTheme(page, 'light')
  await page.goto('/')
  await hydrated(page)
  await signOut(page)

  await signIn(page, driver.email, driver.password, tenant.name)
  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible()
  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible()
})

test('a failed locale save shows the existing failure message', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-locale-fail')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await hydrated(page)
  await page.route('**/api/locale', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Promjena jezika nije spremljena. Pokušajte ponovno.' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toHaveCount(0)
})

test('the theme control changes light and dark for this browser only', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-theme')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  // The theme class is set before Vue hydrates. A click in that gap is lost.
  await hydrated(page)
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  const writes: string[] = []
  const onRequest = (request: { method: () => string, url: () => string }) => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/'))
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
  }
  page.on('request', onRequest)
  try {
    await page.getByRole('button', { name: 'Tamna', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')

    await page.getByRole('button', { name: 'Svijetla', exact: true }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('light')

    // After a fixed choice, follow-the-device tracks the phone again.
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.getByRole('button', { name: 'Prema uređaju', exact: true }).click()
    await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('system')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    expect(writes).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
})

test('an admin and a dispatcher open Profile from the user menu', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-entry')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const members = [
    { email: tenant.adminEmail, password: tenant.password },
    dispatcher,
  ]

  for (const member of members) {
    await signIn(page, member.email, member.password, tenant.name)
    const menuHere = await openUserMenu(page, tenant.name)
    await menuHere.getByRole('menuitem', { name: 'Moj profil', exact: true }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toBeVisible()

    await page.goto('/')
    await hydrated(page)
    const menu = await openUserMenu(page, tenant.name)
    await menu.getByRole('menuitem', { name: 'Moj profil', exact: true }).click()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await signOut(page)
  }
})

test('driver home opens Profile from the menu and has no office sidebar', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Postavke', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Odjava', exact: true })).toHaveCount(0)
  const menu = await openUserMenu(page, tenant.name)
  await menu.getByRole('menuitem', { name: 'Moj profil', exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Postavke' })).toHaveCount(0)
  await expect(page.getByLabel('E-pošta')).toHaveValue(driver.email)
  await expectNarrowColumn(page)
})

test('a dispatcher and a driver on Profile do not request admin endpoints', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-quiet')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')

  for (const member of [dispatcher, driver]) {
    await signIn(page, member.email, member.password, tenant.name)
    // Home's Members fetch belongs to Home. Profile is measured after that settles.
    await page.waitForLoadState('networkidle')
    const seen: string[] = []
    const onRequest = (request: { method: () => string, url: () => string }) => {
      const path = new URL(request.url()).pathname
      if (isAdminRequest(request.method(), path))
        seen.push(`${request.method()} ${path}`)
    }
    page.on('request', onRequest)
    try {
      await page.goto('/profile')
      await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(seen).toEqual([])
    }
    finally {
      page.off('request', onRequest)
    }
    await page.goto('/')
    await hydrated(page)
    await signOut(page)
  }
})

test('the settings tabs are reachable and operable from the keyboard', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-keys')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/settings/tenant')

  const nav = page.getByRole('navigation', { name: 'Postavke' })
  const tenantTab = nav.getByRole('link', { name: 'Tvrtka', exact: true })
  const members = nav.getByRole('link', { name: 'Članovi', exact: true })
  await expect(nav.getByRole('link', { name: 'Profil', exact: true })).toHaveCount(0)

  await focusByTab(page, tenantTab)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\/tenant$/)
  await expect(tenantTab).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: 'Postavke' }).getByRole('button', { name: 'Spremi', exact: true })).toBeVisible()

  await focusByTab(page, members)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\/members$/)
  await expect(members).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: 'Pozovi člana' })).toBeVisible()
})

test('the old profile address redirects to /profile', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-redirect')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/settings/profile')
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await expect(page.getByLabel('E-pošta')).toHaveValue(tenant.adminEmail)
  await expect(page.getByText('Administrator', { exact: true })).toBeVisible()
  await expect(page.getByText(tenant.name, { exact: true }).last()).toBeVisible()
})

test('language and theme each change in one click from the menu', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-menu')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  const members = [
    { email: tenant.adminEmail, password: tenant.password, englishHome: 'Home' },
    { email: dispatcher.email, password: dispatcher.password, englishHome: 'Home' },
    { email: driver.email, password: driver.password, englishHome: tenant.name },
  ]

  for (const member of members) {
    await signIn(page, member.email, member.password, tenant.name)
    await hydrated(page)
    const menu = await openUserMenu(page, tenant.name)
    const english = page.waitForRequest(request =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/locale',
    )
    await menu.getByRole('menuitem', { name: 'EN', exact: true }).click()
    expect((await english).postDataJSON()).toEqual({ locale: 'en' })
    await expect(page.getByRole('heading', { level: 1, name: member.englishHome })).toBeVisible()

    const themeMenu = await openUserMenu(page, tenant.name)
    await themeMenu.getByRole('menuitem', { name: 'Dark', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')

    const back = await openUserMenu(page, tenant.name)
    const croatian = page.waitForRequest(request =>
      request.method() === 'POST' && new URL(request.url()).pathname === '/api/locale',
    )
    await back.getByRole('menuitem', { name: 'HR', exact: true }).click()
    expect((await croatian).postDataJSON()).toEqual({ locale: 'hr' })
    const light = await openUserMenu(page, tenant.name)
    await light.getByRole('menuitem', { name: 'Svijetla', exact: true }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.goto('/')
    await hydrated(page)
    await signOut(page)
  }
})

test('a superadmin who opens /profile does not see a member profile', async ({ page }) => {
  await seedTenant('profile-platform')
  const owner = await seedSuperadmin('profile-platform')
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(owner.email)
  await page.getByLabel('Lozinka').fill(owner.password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tvrtke' })).toBeVisible()

  await page.goto('/profile')
  await expect(page.getByRole('alert')).toContainText('Niste član nijednog prijevoznika. Odjavite se ili zatražite novu pozivnicu.')
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toHaveCount(0)
  await expect(page.getByLabel('E-pošta')).toHaveCount(0)
})

// @phone: the phone project runs this file as well as the desktop project.
test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`profile is usable in ${theme} mode`, async ({ page }) => {
      const tenant = await seedTenant(`profile-phone-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await page.goto('/profile')
      await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
      await expect(page.getByLabel('E-pošta')).toHaveValue(tenant.adminEmail)
      await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Svijetla', exact: true })).toBeVisible()

      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Hrvatski', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})

/** Tab from the top of the page until this control is focused. */
async function focusByTab(page: Page, tab: ReturnType<Page['getByRole']>) {
  await expect(tab).toBeVisible()
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur()
  })
  for (let step = 0; step < 40 && !(await tab.evaluate(element => element === document.activeElement)); step++)
    await page.keyboard.press('Tab')
  await expect(tab).toBeFocused()
}

/** Locale and theme buttons, in either locale. Signed-in office screens have none. */
async function expectNoLocaleTheme(page: Page) {
  for (const name of ['English', 'Hrvatski', 'Tamna', 'Svijetla', 'Prema uređaju', 'Dark', 'Light', 'Follow the device'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
}

/** Tenant settings writes, Members, invitations, role change, removal, and the audit log. */
function isAdminRequest(method: string, path: string) {
  if (method === 'PATCH' && path === '/api/tenant-settings')
    return true
  if (path === '/api/members' || path.startsWith('/api/members/'))
    return true
  if (path === '/api/invitations' || path.startsWith('/api/invitations/'))
    return true
  if (path === '/api/audit-entries' || path.startsWith('/api/audit-entries/'))
    return true
  return false
}

/** Driver Profile keeps the phone column. */
async function expectNarrowColumn(page: Page) {
  const box = await page.locator('main').evaluate((el) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    return { rem, width: el.getBoundingClientRect().width }
  })
  expect(box.width).toBeLessThanOrEqual(28 * box.rem + 1)
}
