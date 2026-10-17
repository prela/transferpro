import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import pg from 'pg'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, useTheme } from './fixtures/ui'

/**
 * The reset link is not on a screen. The newest verification row for this
 * account is the token Better Auth stored. The fake mailer only: the e2e
 * server refuses to boot when Resend is selected.
 */
// @phone: the phone project runs this file as well as the desktop project.
test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`forgot password in ${theme} passes axe`, async ({ page }) => {
      const tenant = await seedTenant(`forgot-${theme}`)
      const nextPassword = 'e2e-reset-password'
      await useTheme(page, theme)
      await page.goto('/')
      await hydrated(page)

      await expect(page.getByRole('link', { name: 'Zaboravljena lozinka?' })).toBeVisible()
      await checkAxe(page)

      await page.goto('/reset-password#not-a-real-token')
      await hydrated(page)
      await expect.poll(() => new URL(page.url()).hash).toBe('')
      await page.getByLabel('Nova lozinka').fill(nextPassword)
      await page.getByLabel('Potvrda lozinke').fill(nextPassword)
      await page.getByRole('button', { name: 'Spremi lozinku', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Poveznica je istekla ili je već iskorištena.')
      await expect(page.getByRole('link', { name: 'Zatražite novu poveznicu' })).toBeVisible()
      await checkAxe(page)

      await page.goto('/')
      await hydrated(page)
      await page.getByRole('link', { name: 'Zaboravljena lozinka?' }).click()
      await expect(page.getByRole('heading', { level: 2, name: 'Zaboravljena lozinka' })).toBeVisible()
      await checkAxe(page)

      if (theme === 'light') {
        await page.getByRole('button', { name: 'English', exact: true }).click()
        await expect(page.getByRole('heading', { level: 2, name: 'Forgot password' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Send the link', exact: true })).toBeVisible()
        await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Pošalji poveznicu', exact: true })).toBeVisible()
      }

      await page.getByLabel('E-pošta').fill(tenant.adminEmail)
      await page.getByLabel('E-pošta').press('Enter')
      const sent = page.getByRole('status')
      await expect(sent).toContainText('Ako postoji račun za tu e-poštu, poslali smo poveznicu za novu lozinku.')
      await checkAxe(page)

      const token = await resetToken(tenant.adminEmail)
      await page.goto(`/reset-password#${token}`)
      await hydrated(page)
      await expect.poll(() => new URL(page.url()).hash).toBe('')
      await expect(page.getByRole('heading', { level: 2, name: 'Nova lozinka' })).toBeVisible()
      await checkAxe(page)

      await page.getByLabel('Nova lozinka').fill('short')
      await page.getByLabel('Potvrda lozinke').fill('short')
      await page.getByRole('button', { name: 'Spremi lozinku', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Lozinka mora imati najmanje 8 znakova.')

      await page.getByLabel('Nova lozinka').fill(nextPassword)
      await page.getByLabel('Potvrda lozinke').fill('e2e-other-password')
      await page.getByRole('button', { name: 'Spremi lozinku', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('Nova lozinka i potvrda nisu iste.')

      await page.getByLabel('Potvrda lozinke').fill(nextPassword)
      await page.getByLabel('Potvrda lozinke').press('Enter')
      await expect(page.getByRole('status')).toContainText('Lozinka je promijenjena, prijavite se.')
      await expect(page.getByRole('button', { name: 'Prijavi se', exact: true })).toBeVisible()
      await checkAxe(page)

      if (theme === 'light') {
        await page.getByRole('button', { name: 'English', exact: true }).click()
        await expect(page.getByRole('status')).toContainText('Your password was changed. Sign in.')
        await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
      }

      await signIn(page, tenant.adminEmail, nextPassword, tenant.name)
    })
  }
})

/**
 * A click can leave the pointer on the next screen's primary button.
 * Its hover wash is primary at 75% and fails the contrast rule. The check
 * is of the resting screen, so the pointer moves to an empty corner first.
 */
async function checkAxe(page: Page) {
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
}

async function resetToken(email: string): Promise<string> {
  const connectionString = process.env.AUTH_DATABASE_URL
  if (!connectionString)
    throw new Error('AUTH_DATABASE_URL is required')
  const pool = new pg.Pool({ connectionString, max: 1 })
  try {
    const result = await pool.query<{ identifier: string }>(
      `select v.identifier
       from auth.verification v
       join auth."user" u on u.id = v.value
       where lower(u.email) = lower($1)
         and v.identifier like 'reset-password:%'
       order by v.created_at desc
       limit 1`,
      [email],
    )
    const identifier = result.rows[0]?.identifier
    if (!identifier?.startsWith('reset-password:'))
      throw new Error('No reset token row.')
    return identifier.slice('reset-password:'.length)
  }
  finally {
    await pool.end()
  }
}
