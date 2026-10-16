import { expect, test } from '@playwright/test'
import { addCalendarDays, operationalDateInTimeZone } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, signIn, switchLocale, switchTheme } from './fixtures/ui'

const guest = 'Ana Anić'
const tabla = 'GOSPOĐA HORVAT'
const clientName = 'Agencija Mora'
const startPlace = 'Zračna luka Dubrovnik'
const endPlace = 'Hotel Excelsior'

test('dispatcher records a transfer and sees the ride on today\'s list', async ({ page }) => {
  const tenant = await seedTenant('transfers-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)

  await page.getByRole('link', { name: 'Naručitelji' }).click()
  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  const clientDialog = page.getByRole('dialog')
  await clientDialog.getByLabel('Ime').fill(clientName)
  await chooseOption(page, clientDialog.getByRole('combobox', { name: 'Vrsta' }), 'Agencija')
  await clientDialog.getByRole('button', { name: 'Dodaj klijenta', exact: true }).click()
  await expect(clientDialog).toBeHidden()
  await expect(page.getByRole('cell', { name: clientName, exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Početna' }).click()
  await page.getByRole('link', { name: 'Transferi' }).click()
  await expect(page.getByRole('button', { name: tenant.name, exact: true })).toBeVisible()
  await expect(page.getByText('Nema vožnji ovaj dan.')).toBeVisible()

  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime gosta').fill('Privremeno')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Nema vožnji ovaj dan.')).toBeVisible()

  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Zatvori', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Dodaj mjesto za polazište' }).click()
  await dialog.getByLabel('Ime', { exact: true }).fill(startPlace)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Aerodrom')
  await dialog.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()

  await dialog.getByRole('button', { name: 'Dodaj mjesto za odredište' }).click()
  await dialog.getByLabel('Ime', { exact: true }).fill(endPlace)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await dialog.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()

  // Noon on the operational day the board opens on. A calendar-date noon
  // before 05:00 is the next operational day, and a later reload drops the Ride.
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const tooEarly = addCalendarDays(day, -40)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Klijent' }), clientName)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Polazište' }), startPlace)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Odredište' }), startPlace)
  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await dialog.getByLabel('Ime gosta').fill(guest)
  await dialog.getByLabel('Cijena (EUR)').fill('42,50')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(dialog.getByText('Polazište i odredište ne mogu biti isto mjesto.')).toBeVisible()
  await expect(page.getByText('Zabilježeno.')).toHaveCount(0)

  await switchLocale(page, 'en')
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Guest name')).toHaveValue(guest)
  await expect(dialog.getByLabel('Price (EUR)')).toHaveValue('42,50')
  await dialog.getByRole('button', { name: 'Record transfer', exact: true }).click()
  await expect(dialog.getByText('The start and the end cannot be the same place.')).toBeVisible()
  await expect(page.getByText('Recorded.')).toHaveCount(0)

  await switchLocale(page, 'hr')
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Ime gosta')).toHaveValue(guest)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Odredište' }), endPlace)
  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${tooEarly}T12:00`)
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(dialog.getByText('Preuzimanje ne može biti ranije od 30 dana unazad.')).toBeVisible()
  await expect(page.getByText('Zabilježeno.')).toHaveCount(0)

  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await dialog.getByLabel('Tabla').fill(tabla)
  await dialog.getByLabel('Broj leta').fill('OU 384')
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByText('Zabilježeno.')).toBeVisible()
  await expect(page.getByRole('cell', { name: new RegExp(`^${guest}`) })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Tabla' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: startPlace })).toBeVisible()
  await expect(page.getByRole('cell', { name: endPlace })).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Nedodijeljeno/ })).toBeVisible()
  await expect(page.getByLabel('Tabla')).toHaveCount(0)

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { level: 1, name: 'Transfers' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record a transfer', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: 'Flight' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Meet sign' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: new RegExp(`^${guest}`) })).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Unassigned/ })).toBeVisible()
  await expect(page.getByLabel('Meet sign')).toHaveCount(0)

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByLabel('Meet sign')).toHaveCount(0)
  await expect(page.getByRole('cell', { name: new RegExp(`^${guest}`) })).toBeVisible()
  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.getByRole('cell', { name: new RegExp(`^${guest}`) })).toBeVisible()
})
