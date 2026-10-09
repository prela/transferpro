import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { expectSettingsRedirect, signIn } from './fixtures/ui'

const officeLinks = ['Početna', 'Klijenti', 'Lokacije', 'Vozači', 'Vozila', 'Raspored'] as const

test('a dispatcher sees office screens, and Home has no member list or settings form', async ({ page }) => {
  const tenant = await seedTenant('office-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav).toBeVisible()
  for (const name of officeLinks)
    await expect(nav.getByRole('link', { name })).toBeVisible()

  await expect(nav.getByRole('link', { name: 'Revizijski zapisnik', exact: true })).toHaveCount(0)
  await expect(page.getByText('Primjer vremena')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pozovi člana' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Članovi' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ukloni člana', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Uloga' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Postavke' })).toHaveCount(0)
  await expect(page.getByText('Samo administrator može ovo promijeniti.')).toHaveCount(0)

  await nav.getByRole('link', { name: 'Klijenti' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await expect(page.getByText('Još nema klijenata.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dodaj klijenta', exact: true })).toBeVisible()

  await nav.getByRole('link', { name: 'Početna' }).click()
  await nav.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
  await expect(page.getByText('Još nema vozača.')).toBeVisible()
})

test('a driver does not see office navigation or office actions on home', async ({ page }) => {
  const tenant = await seedTenant('office-drv')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('navigation', { name: 'Odjeljci' })).toHaveCount(0)
  for (const name of officeLinks)
    await expect(page.getByRole('link', { name })).toHaveCount(0)

  await expect(page.getByRole('region', { name: 'Pozovi člana' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Članovi' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ukloni člana', exact: true })).toHaveCount(0)
  await expect(page.getByText('Samo administrator može ovo promijeniti.')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Postavke' })).toHaveCount(0)
})

test('a dispatcher who opens tenant settings or members lands on profile', async ({ page }) => {
  const tenant = await seedTenant('office-disp-redirect')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await expectSettingsRedirect(page, '/settings/tenant')
  await expectSettingsRedirect(page, '/settings/members')
  await expect(page.getByRole('navigation', { name: 'Postavke' }).getByRole('link')).toHaveText(['Profil'])
})
