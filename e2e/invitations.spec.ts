import { expect, test } from '@playwright/test'
import { memberPassword, seedTenant } from './fixtures/seed'
import { expectNoInvitationCookie, invite, signIn, signOut } from './fixtures/ui'

test('invite without a role shows the role message', async ({ page }) => {
  const tenant = await seedTenant('invite-role')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const region = page.getByRole('region', { name: 'Pozovi člana' })
  await region.getByLabel('E-pošta').fill(`e2e-norole-${crypto.randomUUID()}@example.test`)
  await region.getByRole('button', { name: 'Pošalji pozivnicu', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Odaberite ulogu prije slanja pozivnice.')
})

test('inviting an existing member shows the already-member message', async ({ page }) => {
  const tenant = await seedTenant('invite-member')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const region = page.getByRole('region', { name: 'Pozovi člana' })
  await region.getByLabel('E-pošta').fill(tenant.adminEmail)
  await region.getByRole('combobox', { name: 'Uloga' }).click()
  await page.getByRole('option', { name: 'Vozač', exact: true }).click()
  await region.getByRole('button', { name: 'Pošalji pozivnicu', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Ova osoba je već član ili već ima pozivnicu na čekanju.')
})

test('opening an invite while signed in as someone else names that account and offers sign-out', async ({ page }) => {
  const tenant = await seedTenant('invite-other')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const link = await invite(page, `e2e-other-${crypto.randomUUID()}@example.test`, 'Vozač')
  await page.goto(link)
  await expect(page.getByRole('alert')).toContainText(`Prijavljeni ste kao ${tenant.adminEmail}. Odjavite se da biste prihvatili ovu pozivnicu.`)
  await expect(page.getByRole('button', { name: 'Odjava', exact: true })).toBeVisible()
})

test('accepts a new account after sign-out, then remove and invite again succeed', async ({ page }) => {
  const tenant = await seedTenant('invite-accept')
  const email = `e2e-accept-${crypto.randomUUID()}@example.test`
  const invitee = 'Nova Vozačica'
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const link = await invite(page, email, 'Vozač')
  await signOut(page)
  await page.goto(link)
  await page.getByLabel('Ime').fill(invitee)
  await page.getByLabel('Lozinka').fill(memberPassword)
  await page.getByRole('button', { name: 'Otvori račun', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: tenant.name })).toBeVisible()
  await expectNoInvitationCookie(page)

  await signOut(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const row = page.getByRole('row', { name: invitee })
  await row.getByRole('button', { name: 'Ukloni člana', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Jeste li sigurni da želite ukloniti ovog člana?')
  await dialog.getByRole('button', { name: 'Da, ukloni', exact: true }).click()
  await expect(page.getByRole('row', { name: invitee })).toHaveCount(0)

  const again = await invite(page, email, 'Vozač')
  expect(again).toContain('/accept-invite#')
  await expect(page.getByText('Ova osoba je već član ili već ima pozivnicu na čekanju.')).toHaveCount(0)
  await expectNoInvitationCookie(page)
})
