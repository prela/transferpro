import { expect, test } from '@playwright/test'
import { calendarDateInTimeZone } from '../shared/date'
import { addCalendarDays } from '../shared/expiring-documents'
import { seedDriverRecord, seedMember, seedTenant, seedVehicleRecord } from './fixtures/seed'
import { signIn, signOut, switchLocale, useTheme } from './fixtures/ui'

const phone = '+385955550000'
const far = '2099-01-01'

test('the dashboard lists expired and soon documents in Croatian and English', async ({ page }) => {
  const soon = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 15)
  const tenant = await seedTenant('expiry-office')
  await seedDriverRecord(tenant.tenantId, {
    name: 'Boris Kovač',
    phone,
    drivingLicenceExpiresOn: '2000-01-01',
    transportLicenceExpiresOn: far,
  })
  await seedDriverRecord(tenant.tenantId, {
    name: 'Ana Horvat',
    phone,
    drivingLicenceExpiresOn: '2000-01-15',
    transportLicenceExpiresOn: soon,
  })
  await seedVehicleRecord(tenant.tenantId, {
    registrationPlate: 'ZG100AA',
    registrationExpiresOn: '2000-03-03',
    technicalInspectionExpiresOn: far,
    insuranceExpiresOn: soon,
  })
  await seedVehicleRecord(tenant.tenantId, {
    registrationPlate: 'ZG999ZZ',
    registrationExpiresOn: '2000-01-01',
    technicalInspectionExpiresOn: '2000-01-01',
    insuranceExpiresOn: '2000-01-01',
    archived: true,
  })

  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Revizijski zapisnik' })).toHaveCount(0)
  const list = page.getByRole('region', { name: 'Dokumenti koji istječu' })
  const items = list.getByRole('listitem')
  await expect(items).toHaveCount(5)
  await expect(items.nth(0)).toContainText('Boris Kovač')
  await expect(items.nth(0)).toContainText('Vozačka dozvola')
  await expect(items.nth(0)).toContainText('1.1.2000.')
  await expect(items.nth(0)).toContainText('Isteklo')
  await expect(items.nth(1)).toContainText('Ana Horvat')
  await expect(items.nth(1)).toContainText('15.1.2000.')
  await expect(items.nth(2)).toContainText('ZG100AA')
  await expect(items.nth(2)).toContainText('Registracija vozila')
  await expect(items.nth(2)).toContainText('3.3.2000.')
  await expect(items.nth(3)).toContainText('Ana Horvat')
  await expect(items.nth(3)).toContainText('Dozvola za prijevoz')
  await expect(items.nth(3)).toContainText('Istječe uskoro')
  await expect(items.nth(4)).toContainText('Osiguranje')
  await expect(items.nth(4)).toContainText('Istječe uskoro')
  await expect(page.getByText('ZG999ZZ')).toHaveCount(0)
  await expect(page.getByText('Tehnički pregled')).toHaveCount(0)
  await expect(page.getByText(phone)).toHaveCount(0)
  await expect(page.getByText('1.1.2099.')).toHaveCount(0)

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { name: 'Counts for the operational day' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Audit log' })).toHaveCount(0)
  const english = page.getByRole('region', { name: 'Expiring documents' })
  await expect(english.getByRole('heading', { name: 'Expiring documents' })).toBeVisible()
  await expect(english.getByRole('listitem').nth(0)).toContainText('Expired')
  await expect(english.getByRole('listitem').nth(0)).toContainText('Driving licence')
  await expect(english.getByRole('listitem').nth(0)).toContainText('01/01/2000')
  await expect(english.getByRole('listitem').nth(3)).toContainText('Expiring soon')
  await expect(english.getByRole('listitem').nth(3)).toContainText('Transport licence')
  await expect(page.getByText(phone)).toHaveCount(0)
})

test('a driver sees only their own licences', async ({ page }) => {
  const soon = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 15)
  const tenant = await seedTenant('expiry-driver')
  const linked = await seedMember(tenant.tenantId, 'driver', 'Ana')
  const unlinked = await seedMember(tenant.tenantId, 'driver', 'Niko')
  await seedDriverRecord(tenant.tenantId, {
    name: 'Ana Horvat',
    phone,
    drivingLicenceExpiresOn: '2000-01-15',
    transportLicenceExpiresOn: soon,
    memberUserId: linked.userId,
  })
  await seedDriverRecord(tenant.tenantId, {
    name: 'Boris Kovač',
    phone,
    drivingLicenceExpiresOn: '2000-01-01',
    transportLicenceExpiresOn: far,
  })
  await seedVehicleRecord(tenant.tenantId, {
    registrationPlate: 'ZG100AA',
    registrationExpiresOn: '2000-03-03',
    technicalInspectionExpiresOn: far,
    insuranceExpiresOn: far,
  })

  await signIn(page, linked.email, linked.password, tenant.name)
  const items = page.getByRole('region', { name: 'Dokumenti koji istječu' }).getByRole('listitem')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('Ana Horvat')
  await expect(items.nth(0)).toContainText('Isteklo')
  await expect(items.nth(1)).toContainText('Istječe uskoro')
  await expect(page.getByText('Boris Kovač')).toHaveCount(0)
  await expect(page.getByText('ZG100AA')).toHaveCount(0)
  await expect(page.getByText(phone)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Vozila' })).toHaveCount(0)

  await signOut(page)
  await signIn(page, unlinked.email, unlinked.password, tenant.name)
  await expect(page.getByText('Nema isteklih dokumenata ni dokumenata koji istječu u sljedećih 30 dana.')).toBeVisible()
  await expect(page.getByText('Ana Horvat')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

for (const theme of ['light', 'dark'] as const) {
  test(`expiring documents are visible in ${theme} mode`, async ({ page }) => {
    const tenant = await seedTenant(`expiry-theme-${theme}`)
    await useTheme(page, theme)
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
    await expect(page.getByText('Nema isteklih dokumenata ni dokumenata koji istječu u sljedećih 30 dana.')).toBeVisible()
    await switchLocale(page, 'en')
    await expect(page.getByRole('heading', { name: 'Expiring documents' })).toBeVisible()
    await expect(page.getByText('No documents are expired or expire within the next 30 days.')).toBeVisible()
  })
}
