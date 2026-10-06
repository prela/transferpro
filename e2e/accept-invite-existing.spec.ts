import { expect, test } from '@playwright/test'
import { seedTenant, seedUserWithoutMembership } from './fixtures/seed'
import { invite, signIn, signOut } from './fixtures/ui'

test('an existing account signs in on the invite page and joins as a driver', async ({ page }) => {
  const tenant = await seedTenant('invite-existing')
  const existing = await seedUserWithoutMembership('invite-existing')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const link = await invite(page, existing.email, 'Vozač')
  await signOut(page)

  await page.goto(link)
  await expect(page.getByRole('heading', { level: 1, name: 'Prihvati pozivnicu' })).toBeVisible()
  await expect(page.getByText('Već imate račun. Prijavite se da biste prihvatili pozivnicu.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Otvori račun', exact: true })).toHaveCount(0)
  await page.getByLabel('E-pošta').fill(existing.email)
  await page.getByLabel('Lozinka').fill(existing.password)
  await page.getByRole('button', { name: 'Prijavi se i prihvati', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Pozovi člana' })).toHaveCount(0)
  await expect(page.getByText('Samo administrator može ovo promijeniti.')).toBeVisible()
})
