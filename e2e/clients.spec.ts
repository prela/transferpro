import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { openAudit, signIn } from './fixtures/ui'

test('admin adds a client, corrects it, and the audit log shows the entries', async ({ page }) => {
  const tenant = await seedTenant('clients-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Klijenti' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  await page.getByLabel('Ime').fill('Ana Kovač')
  await page.getByRole('button', { name: 'Dodaj klijenta', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Odaberite vrstu: agencija, hotel ili osoba.')

  await page.getByLabel('Ime').fill(' ')
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Hotel', exact: true }).click()
  await page.getByRole('button', { name: 'Dodaj klijenta', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Unesite ime.')

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Add client', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Enter a name.')

  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  await page.getByLabel('Ime').fill('Hotel Adriatic')
  await page.getByRole('button', { name: 'Dodaj klijenta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi klijenta: Hotel Adriatic' })).toBeVisible()

  await page.getByRole('button', { name: 'Ispravi klijenta: Hotel Adriatic' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill('Hotel Park')
  await dialog.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Agencija', exact: true }).click()
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Ispravi klijenta: Hotel Park' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Agencija' })).toBeVisible()

  await page.getByLabel('Ime').fill('Marko Marić')
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Osoba', exact: true }).click()
  await page.getByRole('button', { name: 'Dodaj klijenta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi klijenta: Marko Marić' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Osoba' })).toBeVisible()

  // Opening Audit reads the rows this page already wrote.
  await openAudit(page)
  await expect(page.getByRole('cell', { name: 'Klijent dodan', exact: true })).toHaveCount(2)
  await expect(page.getByRole('cell', { name: 'Ime klijenta ispravljeno', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vrsta klijenta ispravljena', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Osoba', exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Klijenti' }).click()
  await expect(page).toHaveURL(/\/clients$/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ispravi klijenta: Hotel Park' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Agencija' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ispravi klijenta: Marko Marić' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Osoba' })).toBeVisible()
})

test('dispatcher adds a client and the screen shows the tenant name', async ({ page }) => {
  const tenant = await seedTenant('clients-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Klijenti' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  await page.getByLabel('Ime').fill('Agencija Sunce')
  await page.getByRole('combobox', { name: 'Vrsta' }).click()
  await page.getByRole('option', { name: 'Agencija', exact: true }).click()
  await page.getByRole('button', { name: 'Dodaj klijenta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi klijenta: Agencija Sunce' })).toBeVisible()
})
