import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays } from '../shared/date'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, openListbox, signIn, switchLocale, switchTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // One instant for the seed and the board, including across 05:00.
  await pinOperationalClock(page)
})

async function chooseMenu(page: Page, dialog: Locator, field: string, option: string) {
  await chooseOption(page, dialog.getByRole('button', { name: field, exact: true }), option)
}

async function addPlace(page: Page, dialog: Locator, field: string, name: string, kind: string) {
  const trigger = dialog.getByRole('button', { name: field, exact: true })
  const listbox = await openListbox(page, trigger)
  await listbox.locator('input').fill(name)
  const created = listbox.getByRole('option', { name: `+ Dodaj ‘${name}’` })
  await expect(created).toBeVisible()
  await created.click()
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), kind)
  await dialog.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()
  await expect(trigger).toContainText(name)
}

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
  await clientDialog.getByRole('button', { name: 'Dodaj naručitelja', exact: true }).click()
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
  await addPlace(page, dialog, 'Polazište', startPlace, 'Aerodrom')
  await addPlace(page, dialog, 'Odredište', endPlace, 'Hotel')

  // Noon on the operational day the board opens on. A calendar-date noon
  // before 05:00 is the next operational day, and a later reload drops the Ride.
  const day = operationalDay(page)
  const tooEarly = addCalendarDays(day, -40)
  await chooseMenu(page, dialog, 'Naručitelj', clientName)
  await chooseMenu(page, dialog, 'Polazište', startPlace)
  await chooseMenu(page, dialog, 'Odredište', startPlace)
  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await dialog.getByLabel('Ime gosta').fill(guest)
  await dialog.getByLabel('Cijena (EUR)').fill('42,50')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(dialog.getByText('Polazište i odredište ne mogu biti isto mjesto.').first()).toBeVisible()
  await expect(page.getByText('Zabilježeno.')).toHaveCount(0)

  await switchLocale(page, 'en')
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Guest name')).toHaveValue(guest)
  await expect(dialog.getByLabel('Price (EUR)')).toHaveValue('42,50')
  await dialog.getByRole('button', { name: 'Record transfer', exact: true }).click()
  await expect(dialog.getByText('The start and the end cannot be the same place.').first()).toBeVisible()
  await expect(page.getByText('Recorded.')).toHaveCount(0)

  await switchLocale(page, 'hr')
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Ime gosta')).toHaveValue(guest)
  await chooseMenu(page, dialog, 'Odredište', endPlace)
  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${tooEarly}T12:00`)
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(dialog.getByText('Preuzimanje ne može biti ranije od 30 dana unazad.').first()).toBeVisible()
  await expect(page.getByText('Zabilježeno.')).toHaveCount(0)

  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await dialog.getByRole('button', { name: 'Više', exact: true }).click()
  await dialog.getByLabel('Tabla').fill(tabla)
  await dialog.getByLabel('Broj leta').fill('OU 384')
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()

  // Saving closes the form and opens the new Ride, with Dodijeli as its action.
  await expect(page.getByRole('article').getByRole('heading', { name: guest })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dodijeli', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Notifications (F8)' }).getByText('Zabilježeno.')).toBeVisible()
  await expect(page.getByRole('cell', { name: new RegExp(`^${guest}`) })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Tabla' })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: startPlace })).toBeVisible()
  await expect(page.getByRole('cell', { name: endPlace })).toBeVisible()
  await expect(page.getByRole('cell', { name: /^Nedodijeljeno/ })).toBeVisible()
  await expect(page.getByLabel('Tabla')).toHaveCount(0)

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { level: 1, name: 'Transfers' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Record a transfer', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toBeVisible()
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
