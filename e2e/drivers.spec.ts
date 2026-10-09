import { expect, test } from '@playwright/test'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, openAudit, signIn, switchLocale } from './fixtures/ui'

const phone = '+385981112233'
const nextPhone = '+385981112244'

test('admin adds a driver, corrects it, and the audit log does not show the phone', async ({ page }) => {
  const tenant = await seedTenant('drivers-admin')
  const linked = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Vozači' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  // Other required fields are filled so the empty name is the only alert.
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Vlastiti')
  await page.getByLabel('Telefon').fill(phone)
  await page.getByLabel('Vozačka dozvola vrijedi do').fill('2027-06-01')
  await page.getByLabel('Dozvola za prijevoz vrijedi do').fill('2028-01-31')
  await page.getByRole('button', { name: 'Dodaj vozača', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Unesite ime.')

  await switchLocale(page, 'en')
  await chooseOption(page, page.getByRole('combobox', { name: 'Kind' }), 'Own')
  await page.getByLabel('Phone').fill(phone)
  await page.getByLabel('Driving licence valid until').fill('2027-06-01')
  await page.getByLabel('Transport licence valid until').fill('2028-01-31')
  await page.getByRole('button', { name: 'Add driver', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Enter a name.')

  await switchLocale(page, 'hr')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Vlastiti')
  await page.getByLabel('Telefon').fill(phone)
  await page.getByLabel('Vozačka dozvola vrijedi do').fill('2027-06-01')
  await page.getByLabel('Dozvola za prijevoz vrijedi do').fill('2028-01-31')
  await page.getByLabel('Ime').fill('Marko Marić')
  await chooseOption(page, page.getByRole('combobox', { name: 'Član' }), linked.name)
  await page.getByRole('button', { name: 'Dodaj vozača', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi vozača: Marko Marić' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vlastiti' })).toBeVisible()
  await expect(page.getByRole('cell', { name: phone })).toBeVisible()
  await expect(page.getByRole('cell', { name: '1.6.2027.' })).toBeVisible()
  await expect(page.getByRole('cell', { name: linked.name })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Ne', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Ispravi vozača: Marko Marić' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill('Mara Marić')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Vanjski')
  await dialog.getByLabel('Telefon').fill(nextPhone)
  await dialog.getByLabel('Vozačka dozvola vrijedi do').fill('2029-03-03')
  await dialog.getByRole('checkbox', { name: 'Mora prihvatiti' }).check()
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Ispravi vozača: Mara Marić' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vanjski' })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextPhone })).toBeVisible()
  await expect(page.getByRole('cell', { name: '3.3.2029.' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Da', exact: true })).toBeVisible()

  await openAudit(page)
  await expect(page.getByRole('cell', { name: 'Vozač dodan', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vozač ispravljen', exact: true }).first()).toBeVisible()
  await expect(page.getByText(phone)).toHaveCount(0)
  await expect(page.getByText(nextPhone)).toHaveCount(0)
  await expect(page.getByText('2027-06-01')).toHaveCount(0)
  await expect(page.getByText('2029-03-03')).toHaveCount(0)

  await page.getByRole('link', { name: 'Vozači' }).click()
  await expect(page).toHaveURL(/\/drivers$/)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Ispravi vozača: Mara Marić' })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextPhone })).toBeVisible()
})

test('dispatcher adds a driver and cannot turn on must-accept', async ({ page }) => {
  const tenant = await seedTenant('drivers-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispecer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Vozači' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()

  await page.getByLabel('Ime').fill('Ivo Ivić')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Vanjski')
  await page.getByLabel('Telefon').fill('+385911100200')
  await page.getByLabel('Vozačka dozvola vrijedi do').fill('2030-04-04')
  await page.getByLabel('Dozvola za prijevoz vrijedi do').fill('2030-05-05')
  await page.getByRole('button', { name: 'Dodaj vozača', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Ispravi vozača: Ivo Ivić' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Bez računa' })).toBeVisible()

  await page.getByRole('button', { name: 'Ispravi vozača: Ivo Ivić' }).click()
  await expect(page.getByRole('dialog').getByRole('checkbox', { name: 'Mora prihvatiti' })).toHaveCount(0)
})
