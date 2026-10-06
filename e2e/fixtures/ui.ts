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

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Odjava', exact: true }).click()
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
 * The invite link is on the screen. The server is the fake mailer, so this
 * does not read a Resend response.
 */
export async function invite(page: Page, email: string, role: InviteRole): Promise<string> {
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
