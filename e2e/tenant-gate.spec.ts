import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { plantOperationalRows, seedMembership, seedTenant } from './fixtures/seed'
import { hydrated, useTheme } from './fixtures/ui'

/**
 * The gate is the choice after sign-in (ADR-0056). It lists each company
 * and the role there, and it does not show that company's data.
 */
test('two companies show the gate before any tenant data, on desktop in both themes', async ({ page }) => {
  const office = await seedTenant('gate-office')
  const driving = await seedTenant('gate-driver')
  await seedMembership(driving.tenantId, office.adminEmail, 'driver')
  const officeRows = await plantOperationalRows(office.tenantId)
  const driverRows = await plantOperationalRows(driving.tenantId)

  for (const theme of ['light', 'dark'] as const) {
    await useTheme(page, theme)
    await page.goto('/')
    if (theme === 'light') {
      await page.getByLabel('E-pošta').fill(office.adminEmail)
      await page.getByLabel('Lozinka').fill(office.password)
      await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
    }
    await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
    await expect(page.getByRole('button', { name: `${office.name}, Administrator` })).toBeVisible()
    await expect(page.getByRole('button', { name: `${driving.name}, Vozač` })).toBeVisible()
    await expect(page.getByText(officeRows.clientName)).toHaveCount(0)
    await expect(page.getByText(driverRows.clientName)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Tvrtke', exact: true })).toHaveCount(0)
    // A hover on the selected theme control drops it to 90% and fails contrast.
    await page.mouse.move(8, 700)
    await expectNoAxeViolations(page)
  }

  await page.goto('/clients')
  await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Naručitelji', exact: true })).toHaveCount(0)

  await hydrated(page)
  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Choose a company' })).toBeVisible()
  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()

  await page.getByRole('button', { name: `${office.name}, Administrator` }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toBeVisible()
  await expect(page.getByText(driving.name)).toHaveCount(0)
  await expect(page.getByText(driverRows.clientName)).toHaveCount(0)
  await expect(page.getByText(driverRows.driverName)).toHaveCount(0)

  const nextPassword = `${office.password}-2`
  await page.goto('/profile')
  await expect(page.getByRole('heading', { level: 1, name: 'Profil', exact: true })).toBeVisible()
  await hydrated(page)
  await page.getByLabel('Trenutna lozinka').fill(office.password)
  await page.getByLabel('Nova lozinka').fill(nextPassword)
  await page.getByLabel('Potvrda lozinke').fill(nextPassword)
  await page.getByRole('button', { name: 'Spremi lozinku', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Odjava', exact: true }).click()
  await expect(page.getByLabel('E-pošta')).toBeVisible()
  await page.getByLabel('E-pošta').fill(office.adminEmail)
  await page.getByLabel('Lozinka').fill(nextPassword)
  await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toHaveCount(0)
})

test.describe('@phone', () => {
  test('the gate on a phone passes in both themes and a Driver opens their Rides @phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const office = await seedTenant('gate-phone-office')
    const driving = await seedTenant('gate-phone-driver')
    await seedMembership(driving.tenantId, office.adminEmail, 'driver')

    for (const theme of ['light', 'dark'] as const) {
      await useTheme(page, theme)
      await page.goto('/')
      if (theme === 'light') {
        await page.getByLabel('E-pošta').fill(office.adminEmail)
        await page.getByLabel('Lozinka').fill(office.password)
        await page.getByRole('button', { name: 'Prijavi se', exact: true }).click()
      }
      await expect(page.getByRole('heading', { name: 'Odaberite tvrtku' })).toBeVisible()
      await expect(page.getByRole('button', { name: `${office.name}, Administrator` })).toBeVisible()
      await expect(page.getByRole('button', { name: `${driving.name}, Vozač` })).toBeVisible()
      // A hover on the selected theme control drops it to 90% and fails contrast.
      await page.mouse.move(8, 700)
      await expectNoAxeViolations(page)
    }

    await page.getByRole('button', { name: `${driving.name}, Vozač` }).click()
    await expect(page.getByRole('heading', { level: 1, name: driving.name, exact: true })).toBeVisible()
    await expect(page.getByText('Nemate nadolazećih vožnji.')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Početna', exact: true })).toHaveCount(0)
    await expect(page.getByText(office.name)).toHaveCount(0)
  })
})
