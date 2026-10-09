import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { openUserMenu, signIn, signOut, useTheme } from './fixtures/ui'

test('/settings opens Profile for an admin, a dispatcher, and a driver', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-open')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')

  const members = [
    { email: tenant.adminEmail, password: tenant.password },
    dispatcher,
    driver,
  ]
  for (const member of members) {
    await signIn(page, member.email, member.password, tenant.name)
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/settings\/profile$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    const tabs = page.getByRole('navigation', { name: 'Postavke' })
    const admin = member.email === tenant.adminEmail
    await expect(tabs.getByRole('link')).toHaveText(admin
      ? ['Profil', 'Organizacija', 'Članovi']
      : ['Profil'])
    await expect(tabs.getByRole('link', { name: 'Profil', exact: true })).toHaveAttribute('aria-current', 'page')
    // Driver Home is where that role signs out. Office staff can leave from here.
    await page.goto('/')
    await hydrated(page)
    await signOut(page)
  }
})

test('profile saves hr and en through POST /api/locale and the next screen uses that language', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-locale')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/settings/profile')
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

  await page.goto('/settings/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  await hydrated(page)
  const croatian = page.waitForRequest(request =>
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/locale',
  )
  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  expect((await croatian).postDataJSON()).toEqual({ locale: 'hr' })
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Početna', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Klijenti', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
})

test('signed-in home and an office page do not show locale or theme buttons', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-no-chrome')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expectNoLocaleTheme(page)

  await page.getByRole('link', { name: 'Klijenti', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await expectNoLocaleTheme(page)

  await page.goto('/settings/tenant')
  await expect(page.getByRole('heading', { level: 1, name: 'Organizacija' })).toBeVisible()
  await expectNoLocaleTheme(page)

  await signOut(page)
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dark theme', exact: true })).toBeVisible()
})

test('an admin, a dispatcher, and a driver save locale and theme on profile and the next screen uses that choice', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-roles')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')

  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await saveEnglishOnProfile(page)
  await page.goto('/clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  await saveDarkOnProfile(page)
  await page.goto('/clients')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  await page.goto('/settings/profile')
  await hydrated(page)
  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await page.getByRole('button', { name: 'Svijetla tema', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.goto('/')
  await hydrated(page)
  await signOut(page)

  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await saveEnglishOnProfile(page)
  await page.goto('/clients')
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  await saveDarkOnProfile(page)
  await page.goto('/clients')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible()
  // Sign-out looks for the Croatian control, and the next Member starts from light.
  await page.goto('/settings/profile')
  await hydrated(page)
  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await page.getByRole('button', { name: 'Svijetla tema', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await page.goto('/')
  await hydrated(page)
  await signOut(page)

  await signIn(page, driver.email, driver.password, tenant.name)
  await saveEnglishOnProfile(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible()
  await saveDarkOnProfile(page)
  await page.goto('/')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('heading', { name: 'My rides' })).toBeVisible()
})

test('a failed locale save shows the existing failure message', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-locale-fail')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/settings/profile')
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
  await page.goto('/settings/profile')
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
    await page.getByRole('button', { name: 'Tamna tema', exact: true }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('dark')

    await page.getByRole('button', { name: 'Svijetla tema', exact: true }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(page.evaluate(() => localStorage.getItem('transferpro-theme'))).resolves.toBe('light')
    expect(writes).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
})

test('an admin and a dispatcher open Profile from the sidebar and the user menu', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-entry')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  const members = [
    { email: tenant.adminEmail, password: tenant.password },
    dispatcher,
  ]

  for (const member of members) {
    await signIn(page, member.email, member.password, tenant.name)
    await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Postavke', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toBeVisible()

    // The parent stays mounted. Choosing Settings again must still open Profile.
    await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Postavke', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    const menuHere = await openUserMenu(page, tenant.name)
    await menuHere.getByRole('menuitem', { name: 'Postavke', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()

    await page.goto('/')
    await hydrated(page)
    const menu = await openUserMenu(page, tenant.name)
    await menu.getByRole('menuitem', { name: 'Postavke', exact: true }).click()
    await expect(page).toHaveURL(/\/settings\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await signOut(page)
  }
})

test('driver home opens Profile in the phone column and has no office sidebar', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Postavke', exact: true }).click()
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Postavke' }).getByRole('link', { name: 'Profil', exact: true })).toBeVisible()
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
      await page.goto('/settings/profile')
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
  await page.goto('/settings/profile')

  const nav = page.getByRole('navigation', { name: 'Postavke' })
  const profile = nav.getByRole('link', { name: 'Profil', exact: true })
  const tenantTab = nav.getByRole('link', { name: 'Organizacija', exact: true })
  const members = nav.getByRole('link', { name: 'Članovi', exact: true })

  await focusByTab(page, profile)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(profile).toHaveAttribute('aria-current', 'page')

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

/** Locale and theme buttons, in either language. Signed-in office screens have none. */
async function expectNoLocaleTheme(page: Page) {
  for (const name of ['English', 'Hrvatski', 'Tamna tema', 'Svijetla tema', 'Dark theme', 'Light theme'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
}

/** Profile is where a signed-in Member saves the Locale. */
async function saveEnglishOnProfile(page: Page) {
  await page.goto('/settings/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
  await hydrated(page)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
}

/** Theme stays on this browser. The following screen reads the same class. */
async function saveDarkOnProfile(page: Page) {
  await page.goto('/settings/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profile' })).toBeVisible()
  await hydrated(page)
  await page.getByRole('button', { name: 'Dark theme', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
}

/** The document is interactive. A click before this misses the Vue handler. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt')
    const app = root ? Reflect.get(root, '__vue_app__') : undefined
    const nuxt = app?.config?.globalProperties?.$nuxt
    return nuxt?.isHydrating === false
  })
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
