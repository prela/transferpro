import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function signIn(page: Page, email: string, password: string, tenantName: string) {
  await page.goto('/')
  await page.getByLabel('E-pošta').fill(email)
  await page.getByLabel('Lozinka').fill(password)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenantName })).toBeVisible()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Odjava', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
}

/**
 * The invite link is on the screen. The server is the fake mailer, so this
 * does not read a Resend response.
 */
export async function invite(page: Page, email: string, role: 'Administrator' | 'Dispečer' | 'Vozač'): Promise<string> {
  const region = page.getByRole('region', { name: 'Pozovi člana' })
  await region.getByLabel('E-pošta').fill(email)
  await region.getByRole('combobox', { name: 'Uloga' }).click()
  await page.getByRole('option', { name: role, exact: true }).click()
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
