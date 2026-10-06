import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

const officeLinks = ['Klijenti', 'Lokacije', 'Vozači', 'Vozila', 'Raspored'] as const

test('a dispatcher sees office screens and read-only settings, and cannot invite', async ({ page }) => {
  const tenant = await seedTenant('office-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)

  const nav = page.getByRole('navigation', { name: 'Odjeljci' })
  await expect(nav).toBeVisible()
  for (const name of officeLinks)
    await expect(nav.getByRole('link', { name })).toBeVisible()

  await expect(page.getByRole('region', { name: 'Pozovi člana' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Članovi' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ukloni člana', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Uloga' })).toHaveCount(0)

  const settings = page.getByRole('region', { name: 'Postavke' })
  await expect(settings.getByText('90', { exact: true })).toBeVisible()
  await expect(settings.getByText('25', { exact: true })).toBeVisible()
  await expect(settings.getByText('Europe/Zagreb', { exact: true })).toBeVisible()
  await expect(settings.getByText('Samo administrator može ovo promijeniti.')).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Spremi', exact: true })).toHaveCount(0)

  await page.getByRole('link', { name: 'Klijenti' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Klijenti' })).toBeVisible()
  await expect(page.getByText('Još nema klijenata.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dodaj klijenta', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Početna' }).click()
  await page.getByRole('link', { name: 'Raspored' }).click()
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
  await expect(page.getByRole('button', { name: 'Ukloni člana', exact: true })).toHaveCount(0)
  await expect(page.getByText('Samo administrator može ovo promijeniti.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Postavke' }).getByRole('button', { name: 'Spremi', exact: true })).toHaveCount(0)
})
