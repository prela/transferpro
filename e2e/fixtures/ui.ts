import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function signIn(page: Page, email: string, password: string, tenantName: string) {
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(email)
  await page.getByLabel('Lozinka').fill(password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenantName })).toBeVisible()
}

/** Apply light or dark theme before the next navigation so color-mode paints the right variant. */
export async function useTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript((value) => {
    localStorage.setItem('transferpro-theme', value)
  }, theme)
}

/** The office navbar trigger's accessible name is the Tenant. */
export async function openUserMenu(page: Page, tenantName: string) {
  await page.getByRole('button', { name: tenantName, exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Office staff keep Odjava in the navbar user menu. A Driver, a Superadmin,
 * and the invitation accept screen still show that control on the page.
 * Open the menu only when Odjava is not already on screen, then click it.
 */
export async function signOut(page: Page) {
  const onPage = page.getByRole('button', { name: 'Odjava', exact: true })
  const inMenu = page.getByRole('menuitem', { name: 'Odjava', exact: true })
  if (!(await onPage.isVisible()) && !(await inMenu.isVisible()))
    await page.locator('button[aria-haspopup="menu"]').click()
  await onPage.or(inMenu).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
}

export type InviteRole = 'Administrator' | 'Dispečer' | 'Vozač'

/**
 * Open a combobox and confirm the named option with the keyboard. A pointer
 * click on the option misses when the list is clipped (the option is attached
 * but outside the viewport).
 */
export async function chooseOption(page: Page, combobox: Locator, name: string) {
  await combobox.click()
  const listbox = page.getByRole('listbox')
  await expect(listbox).toBeVisible()
  const option = listbox.getByRole('option', { name, exact: true })
  await expect(option).toBeAttached()
  await option.scrollIntoViewIfNeeded()
  await option.press('Enter')
  await expect(combobox).toContainText(name)
}

/**
 * Tenant settings writes, Members, invitations, role change, and removal.
 * A GET of tenant settings is not one of these: every Tenant role may read it.
 */
export function isAdminSettingsRequest(method: string, path: string) {
  if (method === 'PATCH' && path === '/api/tenant-settings')
    return true
  if (path === '/api/members' || path.startsWith('/api/members/'))
    return true
  if (path === '/api/invitations' || path.startsWith('/api/invitations/'))
    return true
  return false
}

/**
 * A Dispatcher or a Driver who opens an Admin settings address lands on
 * Profile, and the browser does not call the Admin endpoints above.
 */
export async function expectSettingsRedirect(page: Page, path: '/settings/tenant' | '/settings/members') {
  const seen: string[] = []
  const onRequest = (request: { method: () => string, url: () => string }) => {
    const pathname = new URL(request.url()).pathname
    if (isAdminSettingsRequest(request.method(), pathname))
      seen.push(`${request.method()} ${pathname}`)
  }
  page.on('request', onRequest)
  try {
    await page.goto(path)
    await expect(page).toHaveURL(/\/settings\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Postavke' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Pozovi člana' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Članovi' })).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    expect(seen).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
}

/** The audit log. Opening it reads the rows already written. */
export async function openAudit(page: Page) {
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Revizijski zapisnik', exact: true }).click()
  await expect(page).toHaveURL(/\/audit$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Revizijski zapisnik' })).toBeVisible()
}

/** The invitation form and the Member list live on the Members tab. */
export async function openMembers(page: Page) {
  await page.goto('/settings/members')
  await expect(page.getByRole('region', { name: 'Pozovi člana' })).toBeVisible()
}

/**
 * The invite link is on the screen. The server is the fake mailer, so this
 * does not read a Resend response. The form is the Members tab.
 */
export async function invite(page: Page, email: string, role: InviteRole): Promise<string> {
  await openMembers(page)
  const region = page.getByRole('region', { name: 'Pozovi člana' })
  await region.getByLabel('E-pošta').fill(email)
  const select = region.getByRole('combobox', { name: 'Uloga' })
  await chooseOption(page, select, role)
  await region.getByRole('button', { name: 'Pošalji pozivnicu', exact: true }).click()
  const link = region.getByLabel('Poveznica pozivnice')
  await expect(link).toBeVisible()
  const value = await link.inputValue()
  expect(value).toContain('/accept-invite#')
  return value
}

/** Fails the spec if a cookie from the PR #51 regression is still stored. */
export async function expectNoInvitationCookie(page: Page) {
  const cookies = await page.context().cookies()
  expect(cookies.filter(cookie => cookie.path.includes('/api/invitations'))).toEqual([])
}
