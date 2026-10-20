import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function signIn(page: Page, email: string, password: string, tenantName: string) {
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(email)
  await page.getByLabel('Lozinka').fill(password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  // Office Home's h1 is Početna. A Driver's h1 stays the Tenant name.
  const officeHome = page.getByRole('heading', { level: 1, name: 'Početna', exact: true })
  const driverHome = page.getByRole('heading', { level: 1, name: tenantName, exact: true })
  await expect(officeHome.or(driverHome)).toBeVisible()
}

const localeButton = {
  hr: 'Hrvatski',
  en: 'English',
} as const

const profileHeading = {
  hr: 'Profil',
  en: 'Profile',
} as const

const themeButton = {
  light: /^(Svijetla|Light)$/,
  dark: /^(Tamna|Dark)$/,
  system: /^(Prema uređaju|Follow the device)$/,
} as const

/**
 * The document is interactive. A click before this misses the Vue handler.
 * The theme class is set before Vue hydrates, and the same gap drops a locale click.
 */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt')
    const app = root ? Reflect.get(root, '__vue_app__') : undefined
    const nuxt = app?.config?.globalProperties?.$nuxt
    return nuxt?.isHydrating === false
  })
}

/**
 * Save the Locale on Profile, then return to the screen under test.
 * Signed-in Home, office pages, and settings tabs do not carry this button.
 */
export async function switchLocale(page: Page, locale: 'hr' | 'en') {
  const returnTo = page.url()
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: /^(Profil|Profile)$/ })).toBeVisible()
  await hydrated(page)
  const saved = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/locale'
    && response.ok(),
  )
  await page.getByRole('button', { name: localeButton[locale], exact: true }).click()
  await saved
  await expect(page.getByRole('heading', { level: 1, name: profileHeading[locale] })).toBeVisible()
  if (new URL(returnTo).pathname !== '/profile') {
    await page.goto(returnTo)
    // The returned screen's first click is a Vue handler. Fields that were
    // already in the document survived a click during hydration; a slideover
    // does not.
    await hydrated(page)
  }
}

/**
 * Change light, dark, or follow-the-device on Profile, then return.
 * The choice stays in `transferpro-theme` on this browser.
 */
export async function switchTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  const returnTo = page.url()
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: /^(Profil|Profile)$/ })).toBeVisible()
  await hydrated(page)
  await page.getByRole('button', { name: themeButton[theme] }).click()
  if (theme === 'dark')
    await expect(page.locator('html')).toHaveClass(/dark/)
  else if (theme === 'light')
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  // An earlier useTheme() init script would put the old value back on the next
  // document. Register this choice after it so the return keeps the click.
  await page.addInitScript((value) => {
    localStorage.setItem('transferpro-theme', value)
  }, theme)
  if (new URL(returnTo).pathname !== '/profile') {
    await page.goto(returnTo)
    await hydrated(page)
  }
}

/** Apply light or dark theme before the next navigation so color-mode paints the right variant. */
export async function useTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript((value) => {
    localStorage.setItem('transferpro-theme', value)
  }, theme)
}

/** The office navbar trigger's accessible name is the Tenant, including on a phone where only the initials show. */
export async function openUserMenu(page: Page, tenantName: string) {
  await page.getByRole('button', { name: tenantName, exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

/**
 * The invitation result stays in a modal. That overlay sits above the menu
 * and the sidebar, so a later Odjava or Revizija click never lands.
 * Other dialogs stay: Escape on those is not this helper's job.
 */
async function dismissInviteDialog(page: Page) {
  const dialog = page.getByRole('dialog', { name: /^(Pozovi člana|Invite a member)$/ })
  if (await dialog.count() > 0 && await dialog.first().isVisible()) {
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
  }
}

/**
 * Odjava lives in the profile menu for office staff, the Driver, and a
 * Superadmin. The invitation accept screen still shows that control on the
 * page. Open the menu only when Odjava is not already on screen, then click it.
 */
export async function signOut(page: Page) {
  await dismissInviteDialog(page)
  const onPage = page.getByRole('button', { name: 'Odjava', exact: true })
  const inMenu = page.getByRole('menuitem', { name: 'Odjava', exact: true })
  if (!(await onPage.isVisible()) && !(await inMenu.isVisible()))
    await page.locator('button[aria-haspopup="menu"]').click()
  await onPage.or(inMenu).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
}

export type InviteRole = 'Administrator' | 'Dispečer' | 'Vozač'

/**
 * Open a Nuxt UI select or select menu and return the open listbox.
 *
 * USelect opens on pointerdown. Reka closes that list on pointerup when the
 * pointer has moved, and Nuxt UI's click handler can send a second
 * pointerdown at the origin while the trigger still renders closed, so a
 * later pointerup looks like a drag and closes the list. ArrowDown opens a
 * combobox once. A select menu is a button and toggles on click. The list
 * is ready when the trigger is expanded and the open listbox is on screen.
 */
export async function openListbox(page: Page, trigger: Locator): Promise<Locator> {
  await hydrated(page)
  await expect(trigger).toBeVisible()
  await expect(trigger).toBeEnabled()
  let opened = await trigger.elementHandle()
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    // A create-item click leaves the previous suggestion list open: its
    // handler prevents the select that would close it. Escape dismisses that
    // list, and only while one is open, so it does not dismiss the dialog.
    // The key waits until that node is out of the document. Closing focuses
    // its trigger, and an earlier ArrowDown lands there and opens it again.
    const openList = page.locator('[role="listbox"][data-state="open"]')
    if (await openList.count() > 0) {
      const leaving = await openList.first().elementHandle()
      await page.keyboard.press('Escape')
      if (leaving)
        await page.waitForFunction(node => !node.isConnected, leaving)
    }
    // Taken again after the previous list closes. That close re-renders the
    // form, and a handle from before it would keep the old aria-expanded.
    opened = await trigger.elementHandle()
    if (await trigger.getAttribute('role') === 'combobox')
      await trigger.press('ArrowDown')
    else
      await trigger.click()
    // The open list hides the rest of the page, so a role locator cannot see
    // the trigger. The same node still carries aria-expanded.
    await expect.poll(() => opened?.getAttribute('aria-expanded') ?? null).toBe('true')
  }
  const listboxId = await opened?.getAttribute('aria-controls')
  const listbox = listboxId
    ? page.locator(`[id="${listboxId}"]`)
    : page.locator('[role="listbox"][data-state="open"]')
  await expect(listbox).toBeVisible()
  return listbox
}

/**
 * Open the list and confirm the named option.
 * A pointer click on a combobox option misses when the list is clipped (the
 * option is attached but outside the viewport), so that control confirms
 * with Enter. A select menu option confirms on click, after it is visible.
 * The trigger's text is the caller's check when a rejected choice must not
 * stay on the control.
 */
export async function selectOption(page: Page, trigger: Locator, name: string, exact = true) {
  // Read the role while the trigger is still in the accessibility tree.
  // An open list hides it, and a later role lookup waits until the test times out.
  const combobox = await trigger.getAttribute('role') === 'combobox'
  const listbox = await openListbox(page, trigger)
  // Roster marks a plate already given that day, so the option name is longer
  // than the plate. Callers that need that mark pass exact false.
  const option = listbox.getByRole('option', { name, exact })
  await expect(option).toBeVisible()
  await option.scrollIntoViewIfNeeded()
  if (combobox)
    await option.press('Enter')
  else
    await option.click()
  await expect(listbox).toBeHidden()
}

/** Pick `name` and leave it showing on the trigger. */
export async function chooseOption(page: Page, combobox: Locator, name: string) {
  await selectOption(page, combobox, name)
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
export async function expectSettingsRedirect(page: Page, path: '/settings' | '/settings/tenant' | '/settings/members') {
  const seen: string[] = []
  const onRequest = (request: { method: () => string, url: () => string }) => {
    const pathname = new URL(request.url()).pathname
    if (isAdminSettingsRequest(request.method(), pathname))
      seen.push(`${request.method()} ${pathname}`)
  }
  page.on('request', onRequest)
  try {
    await page.goto(path)
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Profil' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Operativa' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '+ Pozovi člana', exact: true })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Postavke tvrtke' })).toHaveCount(0)
    await page.waitForLoadState('networkidle')
    expect(seen).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
}

/** Opens the row's overflow menu. The contextual action stays a button. */
export async function openRideMenu(page: Page, guest: string) {
  const name = guest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await page.getByRole('button', { name: new RegExp(`^(Radnje|Actions): ${name}$`) }).click()
}

/** The audit log. Opening it reads the rows already written. */
export async function openAudit(page: Page) {
  await dismissInviteDialog(page)
  await page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Revizija', exact: true }).click()
  await expect(page).toHaveURL(/\/audit$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Revizijski zapisnik' })).toBeVisible()
}

/** Članovi is a tab of company settings. The invite form stays in the modal. */
export async function openMembers(page: Page) {
  await page.goto('/settings?tab=members')
  await expect(page.getByRole('heading', { level: 1, name: 'Postavke tvrtke' })).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Pozovi člana', exact: true })).toBeVisible()
}

/** The invitation modal. Sending again is a new invitation, after this one closes. */
export async function openInvite(page: Page) {
  await page.getByRole('button', { name: '+ Pozovi člana', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Pozovi člana' })
  await expect(dialog).toBeVisible()
  return dialog
}

/**
 * The invite link is on the screen. The server is the fake mailer, so this
 * does not read a Resend response. The form is the Members tab.
 */
export async function invite(page: Page, email: string, role: InviteRole): Promise<string> {
  await openMembers(page)
  const dialog = await openInvite(page)
  await dialog.getByLabel('E-pošta').fill(email)
  const select = dialog.getByRole('combobox', { name: 'Uloga' })
  await chooseOption(page, select, role)
  await dialog.getByRole('button', { name: 'Pošalji pozivnicu', exact: true }).click()
  const link = dialog.getByLabel('Poveznica pozivnice')
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
