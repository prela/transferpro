import { expect, test } from '@playwright/test'
import { memberPassword, seedTenant } from './fixtures/seed'
import { chooseOption, expectNoInvitationCookie, invite, openMembers, signIn, signOut } from './fixtures/ui'

test('a failed send shows the message and the copyable invite link', async ({ page }) => {
  const tenant = await seedTenant('invite-mail-fail')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const inviteUrl = 'http://127.0.0.1:3000/accept-invite#6b1e0c3a-3333-4333-8333-333333333333'
  await page.route('**/api/invitations', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ inviteUrl, emailSent: false }),
    })
  })
  const value = await invite(page, `e2e-mail-fail-${crypto.randomUUID()}@example.test`, 'Vozač')
  expect(value).toBe(inviteUrl)
  await expect(page.getByRole('alert')).toContainText('E-pošta nije poslana. Kopirajte poveznicu i pošaljite je sami.')
  const region = page.getByRole('region', { name: 'Pozovi člana' })
  await expect(region.getByLabel('Poveznica pozivnice')).toHaveValue(inviteUrl)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The email was not sent. Copy the link and send it yourself.')
})

test('invite without a role shows the role message', async ({ page }) => {
  const tenant = await seedTenant('invite-role')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openMembers(page)
  const region = page.getByRole('region', { name: 'Pozovi člana' })
  await region.getByLabel('E-pošta').fill(`e2e-norole-${crypto.randomUUID()}@example.test`)
  await region.getByRole('button', { name: 'Pošalji pozivnicu', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Odaberite ulogu prije slanja pozivnice.')
})

test('inviting an existing member shows the already-member message', async ({ page }) => {
  const tenant = await seedTenant('invite-member')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openMembers(page)
  const region = page.getByRole('region', { name: 'Pozovi člana' })
  await region.getByLabel('E-pošta').fill(tenant.adminEmail)
  // This path never shows an invite link, so invite() cannot wait for one.
  await chooseOption(page, region.getByRole('combobox', { name: 'Uloga' }), 'Vozač')
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
  await openMembers(page)
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
