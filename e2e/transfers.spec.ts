import { expect, test } from '@playwright/test'
import { addCalendarDays, operationalDateInTimeZone } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, signIn, switchLocale } from './fixtures/ui'

const guest = 'Ana Anić'
const clientName = 'Agencija Mora'
const startPlace = 'Zračna luka Dubrovnik'
const endPlace = 'Hotel Excelsior'

test('dispatcher records a transfer and sees the ride on today\'s list', async ({ page }) => {
  const tenant = await seedTenant('transfers-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)

  await page.getByRole('link', { name: 'Klijenti' }).click()
  await page.getByLabel('Ime').fill(clientName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Agencija')
  await page.getByRole('button', { name: 'Dodaj klijenta', exact: true }).click()
  await expect(page.getByRole('cell', { name: clientName, exact: true })).toBeVisible()

  await page.getByRole('link', { name: 'Početna' }).click()
  await page.getByRole('link', { name: 'Transferi' }).click()
  await expect(page.getByText(`Organizacija: ${tenant.name}`)).toBeVisible()
  await expect(page.getByText('Nema vožnji ovaj dan.')).toBeVisible()

  await page.getByRole('button', { name: 'Dodaj mjesto za polazište' }).click()
  await page.getByLabel('Ime', { exact: true }).fill(startPlace)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Aerodrom')
  await page.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()

  await page.getByRole('button', { name: 'Dodaj mjesto za odredište' }).click()
  await page.getByLabel('Ime', { exact: true }).fill(endPlace)
  await chooseOption(page, page.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await page.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()

  // Noon on the operational day the board opens on. A calendar-date noon
  // before 05:00 is the next operational day, and a later reload drops the Ride.
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const tooEarly = addCalendarDays(day, -40)
  await chooseOption(page, page.getByRole('combobox', { name: 'Klijent' }), clientName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Polazište' }), startPlace)
  await chooseOption(page, page.getByRole('combobox', { name: 'Odredište' }), startPlace)
  await page.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await page.getByLabel('Ime gosta').fill(guest)
  await page.getByLabel('Cijena (EUR)').fill('42,50')
  await chooseOption(page, page.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(page.getByText('Polazište i odredište ne mogu biti isto mjesto.')).toBeVisible()
  await expect(page.getByText('Zabilježeno.')).toHaveCount(0)

  await switchLocale(page, 'en')
  await chooseOption(page, page.getByRole('combobox', { name: 'Client' }), clientName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Where it starts' }), startPlace)
  await chooseOption(page, page.getByRole('combobox', { name: 'Where it ends' }), startPlace)
  await page.getByLabel('Pickup time').fill(`${day}T12:00`)
  await page.getByLabel('Guest name').fill(guest)
  await page.getByLabel('Price (EUR)').fill('42,50')
  await chooseOption(page, page.getByRole('combobox', { name: 'Payment' }), 'Cash')
  await page.getByRole('button', { name: 'Record transfer', exact: true }).click()
  await expect(page.getByText('The start and the end cannot be the same place.')).toBeVisible()
  await expect(page.getByText('Recorded.')).toHaveCount(0)

  await switchLocale(page, 'hr')
  await chooseOption(page, page.getByRole('combobox', { name: 'Klijent' }), clientName)
  await chooseOption(page, page.getByRole('combobox', { name: 'Polazište' }), startPlace)
  await chooseOption(page, page.getByRole('combobox', { name: 'Odredište' }), endPlace)
  await page.getByLabel('Vrijeme preuzimanja').fill(`${tooEarly}T12:00`)
  await page.getByLabel('Ime gosta').fill(guest)
  await page.getByLabel('Cijena (EUR)').fill('42,50')
  await chooseOption(page, page.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(page.getByText('Preuzimanje ne može biti ranije od 30 dana unazad.')).toBeVisible()
  await expect(page.getByText('Zabilježeno.')).toHaveCount(0)

  await page.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await page.getByLabel('Ime gosta').fill(guest)
  await page.getByLabel('Broj leta').fill('OU 384')
  await page.getByLabel('Cijena (EUR)').fill('42,50')
  await chooseOption(page, page.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()

  await expect(page.getByText('Zabilježeno.')).toBeVisible()
  await expect(page.getByRole('cell', { name: guest, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: startPlace })).toBeVisible()
  await expect(page.getByRole('cell', { name: endPlace })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Nedodijeljeno' })).toBeVisible()

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { level: 1, name: 'Transfers' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record transfer', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: guest, exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Unassigned' })).toBeVisible()
})
