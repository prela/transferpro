import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { invite, signIn, signOut } from './fixtures/ui'

test('the set-password form shows the rules and names the one that failed', async ({ page }) => {
  const tenant = await seedTenant('password')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const link = await invite(page, `e2e-password-${crypto.randomUUID()}@example.test`, 'Vozač')
  await signOut(page)

  const preview = page.waitForResponse(response =>
    response.url().includes('/api/invitations/preview') && response.request().method() === 'POST',
  )
  await page.goto(link)
  const body = await (await preview).json() as { minPasswordLength: number, maxPasswordLength: number }

  await expect(page.getByText(`Lozinka mora imati najmanje ${body.minPasswordLength} i najviše ${body.maxPasswordLength} znakova.`)).toBeVisible()
  await page.getByLabel('Ime').fill('Kratka Lozinka')
  await page.getByLabel('Lozinka').fill('a'.repeat(body.minPasswordLength - 1))
  await page.getByRole('button', { name: 'Otvori račun', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(`Lozinka mora imati najmanje ${body.minPasswordLength} znakova.`)

  await page.getByLabel('Lozinka').fill('a'.repeat(body.maxPasswordLength + 1))
  await page.getByRole('button', { name: 'Otvori račun', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(`Lozinka može imati najviše ${body.maxPasswordLength} znakova.`)
})
