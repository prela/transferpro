import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, openAudit, signIn } from './fixtures/ui'

const place = 'Zračna luka Dubrovnik'
const address = 'Dobrota bb, Čilipi'
const nextPlace = 'Hotel Excelsior'
const nextAddress = 'Frana Supila 12'

test('admin adds a location, corrects it, archives it, and the audit log does not show the address', async ({ page }) => {
  const tenant = await seedTenant('locations-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  await page.getByLabel('Ime').fill(place)
  await page.getByLabel('Adresa').fill(address)
  await page.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Odaberite vrstu: aerodrom, hotel, adresa ili ostalo.')

  await page.getByLabel('Ime').fill(' ')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Aerodrom')
  await page.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Unesite ime.')

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await page.getByRole('button', { name: 'Add location', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Enter a name.')

  await page.getByRole('button', { name: 'Hrvatski', exact: true }).click()
  await page.getByLabel('Ime').fill(place)
  await page.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(page.getByRole('button', { name: `Ispravi lokaciju: ${place}` })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Aerodrom' })).toBeVisible()
  await expect(page.getByRole('cell', { name: address })).toBeVisible()

  await page.getByRole('button', { name: `Ispravi lokaciju: ${place}` }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill(nextPlace)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await dialog.getByLabel('Adresa').fill(nextAddress)
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Ispravi lokaciju: ${nextPlace}` })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Hotel', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextAddress })).toBeVisible()

  await page.getByRole('button', { name: `Arhiviraj: ${nextPlace}` }).click()
  await expect(page.getByRole('button', { name: `Ispravi lokaciju: ${nextPlace}` })).toHaveCount(0)
  await expect(page.getByText('Još nema lokacija.')).toBeVisible()

  await page.getByLabel('Prikaži arhivirane').check()
  await expect(page.getByRole('button', { name: `Ispravi lokaciju: ${nextPlace}` })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Arhivirano' })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextPlace })).toBeVisible()

  await openAudit(page)
  await expect(page.getByRole('cell', { name: 'Lokacija dodana', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Lokacija ispravljena', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Lokacija arhivirana', exact: true })).toBeVisible()
  await expect(page.getByText(place)).toHaveCount(0)
  await expect(page.getByText(address)).toHaveCount(0)
  await expect(page.getByText(nextPlace)).toHaveCount(0)
  await expect(page.getByText(nextAddress)).toHaveCount(0)

  await page.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page).toHaveURL(/\/locations$/)
  await page.reload()
  await expect(page.getByText('Još nema lokacija.')).toBeVisible()
})

test('dispatcher adds a location and the screen shows the tenant name', async ({ page }) => {
  const tenant = await seedTenant('locations-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  await page.getByLabel('Ime').fill('Hotel Park')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await page.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi lokaciju: Hotel Park' })).toBeVisible()
})
