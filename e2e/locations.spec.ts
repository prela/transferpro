import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { recordTransfer } from './fixtures/record-transfer'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, openAudit, signIn, signOut, switchLocale, switchTheme } from './fixtures/ui'

// The fake adapter's suggestion and Embed switches are one flag for the
// whole server. Tests in this file share it, so they must not overlap.
test.describe.configure({ mode: 'serial' })

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

/** The fake adapter's reference. The frame's fragment carries it, not the address. */
const placeRef = 'ChIJfakeDubrovnik'

async function createdId(response: { ok: () => boolean, status: () => number, text: () => Promise<string>, json: () => Promise<unknown> }): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

/** Desktop uses the sidebar. A phone keeps Lokacije behind Više. */
async function openLocations(page: Page) {
  const sidebar = page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Lokacije', exact: true })
  if (await sidebar.isVisible()) {
    await sidebar.click()
  }
  else {
    await page.getByRole('button', { name: 'Više', exact: true }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Lokacije', exact: true }).click()
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Lokacije' })).toBeVisible()
}

/**
 * The frame is the panel's width and 240px high. The fake src carries the
 * reference and the language, and not the address or the Embed key.
 */
async function expectMapFrame(dialog: Locator, name: string, language: 'hr' | 'en') {
  const title = language === 'hr' ? `Karta: ${name}` : `Map: ${name}`
  const frame = dialog.getByTitle(title)
  await expect(frame).toBeVisible()
  const src = await frame.getAttribute('src')
  expect(src).toContain('about:blank#')
  expect(src).toContain(`placeRef=${placeRef}`)
  expect(src).toContain(`language=${language}`)
  expect(src).not.toContain(name)
  expect(src).not.toContain('e2e-embed-key')
  await expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  await expect(frame).toHaveAttribute('allow', '')
  expect(await frame.getAttribute('sandbox')).toBeNull()
  await expect(frame).toHaveCSS('height', '240px')
  const frameBox = await frame.boundingBox()
  const formBox = await dialog.locator('#location-form').boundingBox()
  expect(frameBox).not.toBeNull()
  expect(formBox).not.toBeNull()
  expect(Math.abs((frameBox?.width ?? 0) - (formBox?.width ?? 0))).toBeLessThanOrEqual(2)
  return frame
}

test('the location panel shows the map only after the press, in both languages and both themes', async ({ page }) => {
  const tenant = await seedTenant('locations-map')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: false } })
  const google: string[] = []
  const onRequest = (request: { url: () => string }) => {
    const host = new URL(request.url()).hostname
    if (host.includes('google') || host.includes('gstatic'))
      google.push(request.url())
  }
  page.on('request', onRequest)
  try {
    const loaded = await page.goto('/locations')
    expect((loaded?.headers()['referrer-policy'] ?? '').toLowerCase()).not.toBe('no-referrer')
    await expect(page.locator('meta[name="referrer"]')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Lokacije' })).toBeVisible()

    await page.getByRole('button', { name: '+ Dodaj', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('Ime').fill('Nespremljeno')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
    await dialog.getByLabel('Adresa').fill('Obala 12')
    await dialog.getByRole('option', { name: 'Obala 12, Dubrovnik' }).click()
    await expect(dialog.getByLabel('Adresa')).toHaveValue('Obala 12, Dubrovnik')
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await expect(dialog.locator('iframe')).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Dodaj lokaciju', exact: true }).click()
    await expect(dialog).toBeHidden()

    // The list read can land while another test has the Embed switched off.
    // The place is checked once. The URL is polled, then the list reloads.
    const saved = await (await page.request.get('/api/locations')).json() as {
      locations: { name: string, place: { placeRef: string } | null }[]
    }
    expect(saved.locations.find(location => location.name === 'Nespremljeno')?.place?.placeRef).toBe(placeRef)
    await expect.poll(async () => {
      const body = await (await page.request.get('/api/locations')).json() as {
        locations: { name: string, embedUrl: string | null }[]
      }
      return body.locations.find(location => location.name === 'Nespremljeno')?.embedUrl ?? ''
    }).toContain(`placeRef=${placeRef}`)
    await page.reload()
    await page.getByRole('button', { name: 'Nespremljeno', exact: true }).click()
    dialog = page.getByRole('dialog')
    const show = dialog.getByRole('button', { name: /^(Prikaži na karti|Sakrij kartu)$/ })
    await expect(show).toHaveAccessibleName('Prikaži na karti')
    await expect(show).toHaveAttribute('aria-expanded', 'false')
    await expect(dialog.locator('iframe')).toHaveCount(0)
    await expectNoAxeViolations(page)
    await show.click()
    await expect(show).toBeFocused()
    await expect(show).toHaveAccessibleName('Sakrij kartu')
    await expect(show).toHaveAttribute('aria-expanded', 'true')
    const frame = await expectMapFrame(dialog, 'Nespremljeno', 'hr')
    await expect(frame).toHaveAttribute('id', (await show.getAttribute('aria-controls')) ?? '')
    await expectNoAxeViolations(page)
    await show.click()
    await expect(show).toHaveAccessibleName('Prikaži na karti')
    await expect(dialog.locator('iframe')).toHaveCount(0)

    await show.click()
    await dialog.getByLabel('Adresa').fill('Obala 12, kat 2')
    await expect(dialog.locator('iframe')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Sakrij kartu', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: 'Nespremljeno', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await dialog.getByLabel('Adresa').fill('Obala 9')
    await dialog.getByRole('option', { name: 'Obala 9, Dubrovnik' }).click()
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Spremi', exact: true }).click()
    await expect(dialog).toBeHidden()

    await page.getByRole('button', { name: 'Nespremljeno', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()

    await switchLocale(page, 'en')
    await page.getByRole('button', { name: 'Nespremljeno', exact: true }).click()
    dialog = page.getByRole('dialog')
    const showEn = dialog.getByRole('button', { name: /^(Show on map|Hide map)$/ })
    await expect(showEn).toHaveAccessibleName('Show on map')
    await expect(dialog.locator('iframe')).toHaveCount(0)
    await showEn.click()
    await expect(showEn).toBeFocused()
    await expectMapFrame(dialog, 'Nespremljeno', 'en')
    await expectNoAxeViolations(page)

    await switchTheme(page, 'dark')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('button', { name: 'Nespremljeno', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.locator('iframe')).toHaveCount(0)
    await expectNoAxeViolations(page)
    await dialog.getByRole('button', { name: 'Show on map', exact: true }).click()
    await expectMapFrame(dialog, 'Nespremljeno', 'en')
    await expectNoAxeViolations(page)

    await switchTheme(page, 'light')
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await page.getByRole('button', { name: 'Nespremljeno', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Show on map', exact: true }).click()
    await expectMapFrame(dialog, 'Nespremljeno', 'en')
    expect(google).toEqual([])
  }
  finally {
    page.off('request', onRequest)
  }
})

test('a typed location, an archived location, and a switched-off embed have no map button', async ({ page }) => {
  const tenant = await seedTenant('locations-map-off')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  try {
    const placed = await createdId(await page.request.post('/api/locations', {
      data: {
        name: 'Hotel Karta',
        kind: 'hotel',
        address: 'Put 1',
        place: { provider: 'google', placeRef },
      },
    }))
    await createdId(await page.request.post('/api/locations', {
      data: { name: 'Tipkano', kind: 'address', address: 'Ulica 3' },
    }))
    await page.getByRole('link', { name: 'Lokacije' }).click()

    await page.getByRole('button', { name: 'Tipkano', exact: true }).click()
    let dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()

    await page.getByRole('button', { name: 'Hotel Karta', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()

    expect((await page.request.post(`/api/locations/${placed}/archive`)).ok()).toBeTruthy()
    await page.getByLabel('Prikaži arhivirano').check()
    await page.getByRole('button', { name: 'Hotel Karta', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Arhivirano', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()

    await createdId(await page.request.post('/api/locations', {
      data: {
        name: 'Hotel Još',
        kind: 'hotel',
        address: 'Put 2',
        place: { provider: 'google', placeRef },
      },
    }))
    expect((await page.request.post('/api/locations/embed-mode', { data: { off: true } })).ok()).toBeTruthy()
    await page.reload()
    await page.getByRole('button', { name: 'Hotel Još', exact: true }).click()
    dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
    await expect(dialog.locator('iframe')).toHaveCount(0)
  }
  finally {
    await page.request.post('/api/locations/embed-mode', { data: { off: false } })
  }
})

test('the driver card has no map button', async ({ page }) => {
  const tenant = await seedTenant('locations-map-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Karta',
      kind: 'own',
      phone: '+385911114511',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
      memberUserId: driver.userId,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'E2E451AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Karta', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: {
      name: 'Polazak Karta',
      kind: 'airport',
      iata: 'DBV',
      address: 'Čilipi 1',
      place: { provider: 'google', placeRef },
    },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Vozač', kind: 'hotel', address: 'Put 8' },
  }))
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T16:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: 'Ana Karta',
      price: 10,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
      note: null,
      tabla: '',
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  if (!assigned.ok())
    throw new Error(`${assigned.status()} ${await assigned.text()}`)

  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  const card = page.locator('article').filter({ hasText: 'Ana Karta' })
  await expect(card.getByRole('heading', { name: 'Ana Karta' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Prikaži na karti', exact: true })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'Sakrij kartu', exact: true })).toHaveCount(0)
  await expect(card.locator('iframe')).toHaveCount(0)
  await expect(card.getByRole('link', { name: 'Otvori u kartama' })).toHaveCount(2)
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the location map follows ${theme} on a phone and passes axe`, async ({ page }) => {
      const tenant = await seedTenant(`locations-map-phone-${theme}`)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await switchTheme(page, theme)
      await createdId(await page.request.post('/api/locations', {
        data: {
          name: 'Hotel Telefon',
          kind: 'hotel',
          address: 'Put 4',
          place: { provider: 'google', placeRef },
        },
      }))
      await openLocations(page)
      const english = theme === 'dark'
      if (english)
        await switchLocale(page, 'en')

      await page.getByRole('button', { name: 'Hotel Telefon', exact: true }).click()
      const dialog = page.getByRole('dialog')
      const showName = english ? 'Show on map' : 'Prikaži na karti'
      const hideName = english ? 'Hide map' : 'Sakrij kartu'
      const language = english ? 'en' : 'hr'
      const show = dialog.getByRole('button', { name: showName, exact: true })
      await expect(show).toBeVisible()
      await expect(dialog.locator('iframe')).toHaveCount(0)
      const height = (await show.boundingBox())?.height ?? 0
      if ((page.viewportSize()?.width ?? 0) < 1024)
        expect(height).toBeGreaterThanOrEqual(44)
      await expectNoAxeViolations(page)
      await show.click()
      const hide = dialog.getByRole('button', { name: hideName, exact: true })
      await expect(hide).toBeFocused()
      await expectMapFrame(dialog, 'Hotel Telefon', language)
      await expectNoAxeViolations(page)
    })
  }
})
