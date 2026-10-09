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
    await expect(tabs.getByRole('link')).toHaveText(['Profil'])
    await expect(tabs.getByRole('link', { name: 'Profil', exact: true })).toHaveAttribute('aria-current', 'page')
    // Driver Home is where that role signs out. Office staff can leave from here.
    await page.goto('/')
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
      // Home may still be loading Members when Profile's document starts.
      seen.length = 0
      await page.waitForLoadState('networkidle')
      expect(seen).toEqual([])
    }
    finally {
      page.off('request', onRequest)
    }
    await page.goto('/')
    await signOut(page)
  }
})

test('the Profile tab is reachable from the keyboard', async ({ page }) => {
  const tenant = await seedTenant('settings-profile-keys')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/settings/profile')

  const tab = page.getByRole('navigation', { name: 'Postavke' }).getByRole('link', { name: 'Profil', exact: true })
  await expect(tab).toBeVisible()
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur()
  })
  for (let step = 0; step < 30 && !(await tab.evaluate(element => element === document.activeElement)); step++)
    await page.keyboard.press('Tab')
  await expect(tab).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/settings\/profile$/)
  await expect(tab).toHaveAttribute('aria-current', 'page')
})

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
