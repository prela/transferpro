import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, openAudit, signIn, switchLocale, switchTheme } from './fixtures/ui'

const place = 'Zračna luka Dubrovnik'
const address = 'Dobrota bb, Čilipi'
const nextPlace = 'Hotel Excelsior'
const nextAddress = 'Frana Supila 12'

test('admin adds a location, corrects it, archives it, and the audit log does not show the address', async ({ page }) => {
  const tenant = await seedTenant('locations-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page.getByRole('button', { name: tenant.name, exact: true })).toBeVisible()
  await expect(page.getByText('Još nema lokacija. Dodajte prvu.')).toBeVisible()

  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill(place)
  await dialog.getByLabel('Adresa').fill(address)
  await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Odaberite vrstu: aerodrom, hotel, adresa ili ostalo.')

  await dialog.getByLabel('Ime').fill(' ')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Aerodrom')
  await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Unesite ime.')

  await switchLocale(page, 'en')
  await page.getByRole('button', { name: '+ Add', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(' ')
  await dialog.getByLabel('Address').fill(address)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Kind' }), 'Airport')
  await dialog.getByRole('button', { name: 'Add location', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Enter a name.')

  await switchLocale(page, 'hr')
  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill(place)
  await dialog.getByLabel('Adresa').fill(address)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Aerodrom')
  await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${place}` })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Aerodrom' })).toBeVisible()
  await expect(page.getByRole('cell', { name: address })).toBeVisible()

  await page.getByRole('button', { name: place, exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill(nextPlace)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await dialog.getByLabel('Adresa').fill(nextAddress)
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${nextPlace}` })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Hotel', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextAddress })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Traži' }).fill('Supila')
  await expect(page.getByRole('button', { name: nextPlace, exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Traži' }).fill('nema-ovog')
  await expect(page.getByText('Nema zapisa za ovu pretragu. Promijenite tekst ili dodajte novi.')).toBeVisible()
  await page.getByRole('searchbox', { name: 'Traži' }).fill('')

  await page.getByRole('button', { name: `Radnje: ${nextPlace}` }).click()
  await page.getByRole('menuitem', { name: 'Arhiviraj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('cell', { name: nextPlace, exact: true })).toBeVisible()

  await page.getByRole('button', { name: `Radnje: ${nextPlace}` }).click()
  await page.getByRole('menuitem', { name: 'Arhiviraj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Arhiviraj', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${nextPlace}` })).toHaveCount(0)
  await expect(page.getByText('Još nema lokacija. Dodajte prvu.')).toBeVisible()

  await page.getByLabel('Prikaži arhivirano').check()
  await expect(page.getByRole('button', { name: `Radnje: ${nextPlace}` })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Arhivirano' })).toBeVisible()
  await expect(page.getByRole('cell', { name: nextPlace, exact: true })).toBeVisible()

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
  await expect(page.getByText('Još nema lokacija. Dodajte prvu.')).toBeVisible()
})

test('an airport code is stored, and a hotel has no code field, in both languages and both themes', async ({ page }) => {
  const tenant = await seedTenant('locations-iata')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page.getByLabel('IATA kod (aerodrom)')).toHaveCount(0)

  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('IATA kod (aerodrom)')).toHaveCount(0)
  await dialog.getByLabel('Ime').fill(place)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Aerodrom')
  await expect(dialog.getByLabel('IATA kod (aerodrom)')).toBeVisible()
  await dialog.getByLabel('IATA kod (aerodrom)').fill('db')
  await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Unesite troslovnu oznaku aerodroma.')

  await switchLocale(page, 'en')
  await page.getByRole('button', { name: '+ Add', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(place)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Kind' }), 'Airport')
  await expect(dialog.getByLabel('IATA code (airport)')).toBeVisible()
  await dialog.getByLabel('IATA code (airport)').fill('DB1')
  await dialog.getByRole('button', { name: 'Add location', exact: true }).click()
  await expect(dialog.getByRole('alert')).toContainText('Enter a three-letter airport code.')

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: '+ Add', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(place)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Kind' }), 'Airport')
  await dialog.getByLabel('IATA code (airport)').fill('dbv')
  await expectNoAxeViolations(page)
  await dialog.getByRole('button', { name: 'Add location', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('cell', { name: 'DBV', exact: true })).toBeVisible()

  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.getByRole('cell', { name: 'DBV', exact: true })).toBeVisible()

  await switchLocale(page, 'hr')
  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill(nextPlace)
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await expect(dialog.getByLabel('IATA kod (aerodrom)')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: `Radnje: ${nextPlace}` })).toBeVisible()

  await page.getByRole('button', { name: place, exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('IATA kod (aerodrom)')).toHaveValue('DBV')
  await expectNoAxeViolations(page)
  await dialog.getByLabel('IATA kod (aerodrom)').fill('')
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('cell', { name: 'DBV', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: place, exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('IATA kod (aerodrom)').fill('dbv')
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('cell', { name: 'DBV', exact: true })).toBeVisible()

  await page.getByRole('button', { name: place, exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('IATA kod (aerodrom)')).toBeVisible()
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await expect(dialog.getByLabel('IATA kod (aerodrom)')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('cell', { name: 'DBV', exact: true })).toHaveCount(0)
})

test('dispatcher adds a location and the screen shows the tenant name', async ({ page }) => {
  const tenant = await seedTenant('locations-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Lokacije' }).click()
  await expect(page.getByRole('button', { name: tenant.name, exact: true })).toBeVisible()

  await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ime').fill('Hotel Park')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Radnje: Hotel Park' })).toBeVisible()
})

test('the office picks a suggestion, a hand edit drops it, and a typed address still saves when suggestions are off', async ({ page }) => {
  const tenant = await seedTenant('locations-maps')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: false } })
  try {
    await page.getByRole('link', { name: 'Lokacije' }).click()
    await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Ime').fill('Villa Rosa')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Adresa')
    await dialog.getByLabel('Adresa').fill('Obala 12')
    await expect(dialog.getByRole('option', { name: 'Obala 12, Dubrovnik' })).toBeVisible()
    await expect(dialog.getByText('Google', { exact: true })).toBeVisible()
    await dialog.getByRole('option', { name: 'Obala 12, Dubrovnik' }).click()
    await expect(dialog.getByText('Google', { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel('Adresa')).toHaveValue('Obala 12, Dubrovnik')
    await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
    await expect(dialog).toBeHidden()

    const picked = await page.request.get('/api/locations')
    const pickedBody = await picked.json() as { locations: { id: string, name: string, address: string | null, place: { placeRef: string } | null }[] }
    const row = pickedBody.locations.find(location => location.name === 'Villa Rosa')
    expect(row?.address).toBe('Obala 12, Dubrovnik')
    expect(row?.place?.placeRef).toBe('ChIJfakeDubrovnik')

    await page.getByRole('button', { name: 'Villa Rosa', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Adresa').fill('Obala 12, kat 2')
    await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
    await expect(dialog).toBeHidden()

    const edited = await page.request.get('/api/locations')
    const editedBody = await edited.json() as { locations: { name: string, address: string | null, place: unknown }[] }
    const corrected = editedBody.locations.find(location => location.name === 'Villa Rosa')
    expect(corrected?.address).toBe('Obala 12, kat 2')
    expect(corrected?.place).toBeNull()

    await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Ime').fill('Tipkano')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Adresa')
    await dialog.getByLabel('Adresa').fill('Ulica 3')
    await expect(dialog.getByRole('option', { name: 'Ulica 3, Dubrovnik' })).toBeVisible()
    await dialog.getByLabel('Adresa').press('Enter')
    await expect(dialog).toBeHidden()
    const typedIn = await page.request.get('/api/locations')
    const typedBody = await typedIn.json() as { locations: { name: string, address: string | null, place: unknown }[] }
    const typedRow = typedBody.locations.find(location => location.name === 'Tipkano')
    expect(typedRow?.address).toBe('Ulica 3')
    expect(typedRow?.place).toBeNull()

    await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: true } })
    await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('Ime').fill('Kuća Mira')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Adresa')
    await dialog.getByLabel('Adresa').fill('Put 4')
    await expect(dialog.getByText('Prijedlozi adresa nisu dostupni. Adresu i dalje možete upisati.')).toBeVisible()
    await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
    await expect(dialog).toBeHidden()

    const saved = await page.request.get('/api/locations')
    const savedBody = await saved.json() as { locations: { name: string, address: string | null, place: unknown }[] }
    const plain = savedBody.locations.find(location => location.name === 'Kuća Mira')
    expect(plain?.address).toBe('Put 4')
    expect(plain?.place).toBeNull()
  }
  finally {
    await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: false } })
  }
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`an office user sets and clears an airport code in ${theme}`, async ({ page }) => {
      const tenant = await seedTenant(`locations-iata-phone-${theme}`)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await switchTheme(page, theme)
      // Phone keeps catalogs behind Više. The sidebar link is not on this width.
      const sidebar = page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Lokacije', exact: true })
      if (await sidebar.isVisible()) {
        await sidebar.click()
      }
      else {
        await page.getByRole('button', { name: 'Više', exact: true }).click()
        await page.getByRole('dialog').getByRole('link', { name: 'Lokacije', exact: true }).click()
      }
      await expect(page.getByRole('heading', { level: 1, name: 'Lokacije' })).toBeVisible()
      await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
      let dialog = page.getByRole('dialog')
      await dialog.getByLabel('Ime').fill('Zračna luka Zadar')
      await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Aerodrom')
      await dialog.getByLabel('IATA kod (aerodrom)').fill('zad')
      await expectNoAxeViolations(page)
      await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
      await expect(dialog).toBeHidden()

      const stored = await page.request.get('/api/locations')
      const storedBody = await stored.json() as { locations: { name: string, iata: string | null }[] }
      expect(storedBody.locations.find(location => location.name === 'Zračna luka Zadar')?.iata).toBe('ZAD')

      await page.getByRole('button', { name: 'Zračna luka Zadar', exact: true }).click()
      dialog = page.getByRole('dialog')
      await expect(dialog.getByLabel('IATA kod (aerodrom)')).toHaveValue('ZAD')
      await expectNoAxeViolations(page)
      await dialog.getByLabel('IATA kod (aerodrom)').fill('')
      await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
      await expect(dialog).toBeHidden()

      const cleared = await page.request.get('/api/locations')
      const clearedBody = await cleared.json() as { locations: { name: string, iata: string | null }[] }
      expect(clearedBody.locations.find(location => location.name === 'Zračna luka Zadar')?.iata).toBeNull()
    })
  }
})
