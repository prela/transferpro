import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { failInvitationMail, memberPassword, seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, expectNoInvitationCookie, invite, openInvite, openMembers, signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

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
      body: JSON.stringify({ inviteUrl, mail: 'not_sent' }),
    })
  })
  const value = await invite(page, `e2e-mail-fail-${crypto.randomUUID()}@example.test`, 'Vozač')
  expect(value).toBe(inviteUrl)
  await expect(page.getByRole('alert')).toContainText('E-pošta nije poslana. Kopirajte poveznicu i pošaljite je sami.')
  const region = page.getByRole('dialog', { name: 'Pozovi člana' })
  await expect(region.getByLabel('Poveznica pozivnice')).toHaveValue(inviteUrl)
  await page.keyboard.press('Escape')
  await switchLocale(page, 'en')
  await page.getByRole('button', { name: '+ Invite a member', exact: true }).click()
  const english = page.getByRole('dialog', { name: 'Invite a member' })
  await english.getByLabel('Email').fill(`e2e-mail-fail-en-${crypto.randomUUID()}@example.test`)
  await chooseOption(page, english.getByRole('combobox', { name: 'Role' }), 'Driver')
  await english.getByRole('button', { name: 'Send invite', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('The email was not sent. Copy the link and send it yourself.')
})

test('a failed first send says it will try again, and the Admin resends it from Home in both themes', async ({ page }) => {
  // The fake mailer rejects this address. The automatic retries take about
  // 36 minutes, so the fixture leaves the failed row they would.
  const tenant = await seedTenant('invite-outbox')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  const failing = 'invite-fail@example.test'
  const delivered = `e2e-outbox-${tenant.tenantId.slice(0, 8)}@example.test`
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const failingLink = await invite(page, failing, 'Vozač')
  const dialog = page.getByRole('dialog', { name: 'Pozovi člana' })
  await expect(dialog.getByRole('alert')).toContainText('Mail nije poslan, pokušat ćemo ponovno.')
  await expect(dialog.getByLabel('Poveznica pozivnice')).toHaveValue(failingLink)
  await page.keyboard.press('Escape')
  const deliveredLink = await invite(page, delivered, 'Dispečer')
  await expect(page.getByRole('dialog', { name: 'Pozovi člana' }).getByRole('status')).toContainText('Pozivnica je poslana.')
  await page.keyboard.press('Escape')
  await failInvitationMail(tenant.tenantId, new URL(failingLink).hash.slice(1))
  await failInvitationMail(tenant.tenantId, new URL(deliveredLink).hash.slice(1))

  await page.goto('/')
  const block = page.getByRole('region', { name: /Neuspjeli mailovi \(2\)/ })
  await expect(block).toBeVisible()
  await expect(block).toContainText(failing)
  await expect(block).toContainText('Pozivnica · Vozač')
  await expect(block).toContainText('Pozivnica · Dispečer')
  await expect(block).not.toContainText(new URL(failingLink).hash.slice(1))
  await switchTheme(page, 'light')
  await expectNoAxeViolations(page)

  await block.getByRole('button', { name: `Pošalji ponovno pozivnicu: ${delivered}`, exact: true }).click()
  await expect(page.getByRole('region', { name: /Neuspjeli mailovi \(1\)/ })).toBeVisible()
  await page.getByRole('button', { name: `Pošalji ponovno pozivnicu: ${failing}`, exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Mail nije poslan.' })).toBeVisible()

  await switchLocale(page, 'en')
  const english = page.getByRole('region', { name: /Failed mail \(1\)/ })
  await expect(english).toContainText('Invitation · Driver')
  await expect(english.getByRole('button', { name: `Send the invitation again: ${failing}`, exact: true })).toBeVisible()

  await switchLocale(page, 'hr')
  await signOut(page)
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await expect(page.getByRole('heading', { name: /Neuspjeli mailovi|Failed mail/ })).toHaveCount(0)
  await expect(page.getByText(failing)).toHaveCount(0)
})

test('invite without a role shows the role message', async ({ page }) => {
  const tenant = await seedTenant('invite-role')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openMembers(page)
  const region = await openInvite(page)
  await region.getByLabel('E-pošta').fill(`e2e-norole-${crypto.randomUUID()}@example.test`)
  await region.getByRole('button', { name: 'Pošalji pozivnicu', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Odaberite ulogu prije slanja pozivnice.')
})

test('inviting an existing member shows the already-member message', async ({ page }) => {
  const tenant = await seedTenant('invite-member')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openMembers(page)
  const region = await openInvite(page)
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
  await row.getByRole('button', { name: `Radnje: ${invitee}` }).click()
  await page.getByRole('menuitem', { name: 'Ukloni', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Jeste li sigurni da želite ukloniti ovog člana?')
  await expect(dialog).toContainText('Odmah će izgubiti pristup.')
  await dialog.getByRole('button', { name: 'Da, ukloni', exact: true }).click()
  await expect(page.getByRole('row', { name: invitee })).toHaveCount(0)

  const again = await invite(page, email, 'Vozač')
  expect(again).toContain('/accept-invite#')
  await expect(page.getByText('Ova osoba je već član ili već ima pozivnicu na čekanju.')).toHaveCount(0)
  await expectNoInvitationCookie(page)
})
