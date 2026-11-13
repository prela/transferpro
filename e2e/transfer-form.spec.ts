import type { Locator, Page } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, openListbox, signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // One instant for the seed and the board, including across 05:00.
  await pinOperationalClock(page)
})

/**
 * Transfer form in the Ride panel (issue #259): Više, quick add, and the
 * local draft. The phone project runs the @phone block.
 */

async function createdId(page: Page, path: string, data: unknown): Promise<void> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
}

async function chooseMenu(page: Page, dialog: Locator, field: string, option: string) {
  await chooseOption(page, dialog.getByRole('button', { name: field, exact: true }), option)
}

async function openForm(page: Page): Promise<Locator> {
  await page.goto('/transfers')
  await hydrated(page)
  await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

async function createFromSelect(page: Page, dialog: Locator, field: string, name: string, addLabel = `+ Dodaj ‘${name}’`) {
  const trigger = dialog.getByRole('button', { name: field, exact: true })
  const listbox = await openListbox(page, trigger)
  await listbox.locator('input').fill(name)
  const created = listbox.getByRole('option', { name: addLabel })
  await expect(created).toBeVisible()
  await created.click()
  return trigger
}

test('a reload restores the draft, Odbaci removes it, and another user never sees it', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('transfer-draft')
  const other = await seedMember(tenant.tenantId, 'dispatcher', 'Drugi')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const dialog = await openForm(page)
  await dialog.getByLabel('Ime gosta').fill('Ana Skica')
  await page.reload()
  await hydrated(page)
  const restored = page.getByRole('dialog')
  await expect(restored.getByText('Vraćen nedovršeni unos')).toBeVisible()
  await expect(restored.getByLabel('Ime gosta')).toHaveValue('Ana Skica')

  // Drop the cookie without the client sign-out, which would delete the draft.
  // The other user on this browser must not see a draft that is still stored.
  await page.request.post('/api/auth/sign-out', { data: {} })
  await signIn(page, other.email, other.password, tenant.name)
  await page.goto('/transfers')
  await hydrated(page)
  await expect(page.getByText('Vraćen nedovršeni unos')).toHaveCount(0)
  await expect(page.getByText('Ana Skica')).toHaveCount(0)

  await signOut(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/transfers')
  await hydrated(page)
  const again = page.getByRole('dialog')
  await expect(again.getByText('Vraćen nedovršeni unos')).toBeVisible()
  await expect(again.getByLabel('Ime gosta')).toHaveValue('Ana Skica')
  await again.getByRole('button', { name: 'Odbaci', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await hydrated(page)
  await expect(page.getByText('Vraćen nedovršeni unos')).toHaveCount(0)
  await expect(page.getByLabel('Ime gosta')).toHaveCount(0)
})

test('quick add returns the new Client and the new Location selected', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('transfer-quick-add')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const dialog = await openForm(page)

  const client = await createFromSelect(page, dialog, 'Naručitelj', 'Agencija Brza')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Agencija')
  await dialog.getByRole('button', { name: 'Dodaj naručitelja', exact: true }).click()
  await expect(client).toContainText('Agencija Brza')

  const place = await createFromSelect(page, dialog, 'Polazište', 'Hotel Brzi')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
  await dialog.getByLabel('Adresa', { exact: true }).fill('Obala 1')
  await dialog.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()
  await expect(place).toContainText('Hotel Brzi')
})

/** The suggestion pause is 300ms. This waits past it so a missing request is real. */
async function pastSuggestPause(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => window.setTimeout(resolve, 500)))
}

test('quick add picks a place from the name or the address', async ({ page }) => {
  test.setTimeout(180_000)
  const tenant = await seedTenant('transfer-place-pick')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: false } })
  const lookups: { text: string, sessionToken: string }[] = []
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/api/locations/suggestions'))
      return
    const body = request.postDataJSON() as { text?: string, sessionToken?: string }
    if (body.text && body.sessionToken)
      lookups.push({ text: body.text, sessionToken: body.sessionToken })
  })
  try {
    const dialog = await openForm(page)
    const before = lookups.length
    await createFromSelect(page, dialog, 'Polazište', 'Hotel Brzi')
    // The create row used to leave this menu open, so the next key stayed in its search.
    await expect(page.locator('[role="listbox"][data-state="open"]')).toHaveCount(0)
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
    await pastSuggestPause(page)
    expect(lookups.length).toBe(before)

    const prefilledName = dialog.getByLabel('Ime', { exact: true })
    await expect(prefilledName).toBeFocused()
    await prefilledName.press('End')
    await prefilledName.press('q')
    await expect(dialog.getByRole('option', { name: 'Hotel Brziq, Dubrovnik' })).toBeVisible()
    await expect(dialog.getByText('Google Maps', { exact: true })).toBeVisible()
    await page.mouse.move(0, 0)
    await expectNoAxeViolations(page)
    await dialog.getByRole('option', { name: 'Hotel Brziq, Dubrovnik' }).click()
    await expect(dialog.getByLabel('Ime', { exact: true })).toHaveValue('Hotel Brziq')
    await expect(dialog.getByLabel('Adresa', { exact: true })).toHaveValue('Dubrovnik')
    await dialog.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Polazište', exact: true })).toContainText('Hotel Brziq')

    await createFromSelect(page, dialog, 'Odredište', 'Vila Ana')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
    await dialog.getByLabel('Adresa', { exact: true }).pressSequentially('Obala 4')
    await expect(dialog.getByRole('option', { name: 'Obala 4, Dubrovnik' })).toBeVisible()
    await page.mouse.move(0, 0)
    await expectNoAxeViolations(page)
    await dialog.getByRole('option', { name: 'Obala 4, Dubrovnik' }).click()
    await expect(dialog.getByLabel('Ime', { exact: true })).toHaveValue('Vila Ana')
    await expect(dialog.getByLabel('Adresa', { exact: true })).toHaveValue('Dubrovnik')
    await dialog.getByLabel('Adresa', { exact: true }).fill('Ulica 9')
    await dialog.getByRole('option', { name: 'Ulica 9, ulica' }).click()
    await expect(dialog.getByLabel('Ime', { exact: true })).toHaveValue('Vila Ana')
    await expect(dialog.getByLabel('Adresa', { exact: true })).toHaveValue('Ulica 9, ulica')
    await dialog.getByLabel('Ime', { exact: true }).fill('   ')
    await dialog.getByLabel('Adresa', { exact: true }).fill('Riva 2')
    await dialog.getByRole('option', { name: 'Riva 2, Dubrovnik' }).click()
    await expect(dialog.getByLabel('Ime', { exact: true })).toHaveValue('Riva 2')
    await expect(dialog.getByLabel('Adresa', { exact: true })).toHaveValue('Dubrovnik')

    const beforeKind = lookups.length
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Adresa')
    await dialog.getByLabel('Ime', { exact: true }).fill('Gost Ana')
    await pastSuggestPause(page)
    expect(lookups.length).toBe(beforeKind)
    await expect(dialog.getByRole('option', { name: 'Gost Ana, Dubrovnik' })).toHaveCount(0)
    await dialog.getByLabel('Adresa', { exact: true }).fill('Put 7')
    await expect(dialog.getByRole('option', { name: 'Put 7, Dubrovnik' })).toBeVisible()
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
    await dialog.getByLabel('Ime', { exact: true }).fill('Gost Anica')
    await expect(dialog.getByRole('option', { name: 'Gost Anica, Dubrovnik' })).toBeVisible()
    await dialog.getByLabel('Ime', { exact: true }).press('Enter')
    await expect(dialog.getByRole('button', { name: 'Odredište', exact: true })).toContainText('Gost Anica')

    const saved = await (await page.request.get('/api/locations')).json() as {
      locations: { name: string, address: string | null, place: { provider: string, placeRef: string } | null }[]
    }
    expect(saved.locations.find(location => location.name === 'Hotel Brziq')?.place).toEqual({
      provider: 'google',
      placeRef: 'ChIJfakeDubrovnik',
    })
    expect(saved.locations.find(location => location.name === 'Gost Anica')?.place).toBeNull()

    const nameToken = lookups.find(lookup => lookup.text === 'Hotel Brziq')?.sessionToken
    const addressToken = lookups.find(lookup => lookup.text === 'Obala 4')?.sessionToken
    expect(nameToken).toBeTruthy()
    expect(addressToken).toBeTruthy()
    expect(nameToken).not.toBe(addressToken)

    await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: true } })
    await createFromSelect(page, dialog, 'Polazište', 'Hotel Tiho')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
    await dialog.getByLabel('Ime', { exact: true }).fill('Hotel Tišina')
    const notice = 'Prijedlozi mjesta nisu dostupni. Naziv i adresu i dalje možete upisati.'
    await expect(dialog.getByText(notice)).toBeVisible()
    await expect(dialog.getByText(notice)).toHaveCount(1)
    await dialog.getByLabel('Adresa', { exact: true }).fill('Put 2')
    await expect(dialog.getByText(notice)).toHaveCount(1)
    await dialog.getByRole('button', { name: 'Dodaj mjesto', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Polazište', exact: true })).toContainText('Hotel Tišina')
    const plain = await (await page.request.get('/api/locations')).json() as {
      locations: { name: string, place: unknown }[]
    }
    expect(plain.locations.find(location => location.name === 'Hotel Tišina')?.place).toBeNull()

    await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: false } })
    await switchLocale(page, 'en')
    await page.goto('/transfers')
    await hydrated(page)
    await page.getByRole('button', { name: 'Record a transfer', exact: true }).click()
    const english = page.getByRole('dialog')
    await createFromSelect(page, english, 'Where it starts', 'Hotel English', '+ Add ‘Hotel English’')
    await chooseOption(page, english.getByRole('combobox', { name: 'Kind' }), 'Hotel')
    const englishName = english.getByLabel('Name', { exact: true })
    await expect(englishName).toBeFocused()
    await englishName.press('End')
    await englishName.pressSequentially(' 2')
    await expect(english.getByRole('option', { name: 'Hotel English 2, Dubrovnik' })).toBeVisible()
    await page.mouse.move(0, 0)
    await expectNoAxeViolations(page)
    await english.getByLabel('Address', { exact: true }).pressSequentially('Shore 5')
    await expect(english.getByRole('option', { name: 'Shore 5, Dubrovnik' })).toBeVisible()
    await page.mouse.move(0, 0)
    await expectNoAxeViolations(page)

    await switchTheme(page, 'dark')
    await page.goto('/transfers')
    await hydrated(page)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('button', { name: 'Record a transfer', exact: true }).click()
    const dark = page.getByRole('dialog')
    await createFromSelect(page, dark, 'Where it starts', 'Hotel Dark', '+ Add ‘Hotel Dark’')
    await chooseOption(page, dark.getByRole('combobox', { name: 'Kind' }), 'Hotel')
    const darkName = dark.getByLabel('Name', { exact: true })
    await expect(darkName).toBeFocused()
    await darkName.press('End')
    await darkName.pressSequentially(' 2')
    await expect(dark.getByRole('option', { name: 'Hotel Dark 2, Dubrovnik' })).toBeVisible()
    await page.mouse.move(0, 0)
    await expectNoAxeViolations(page)
    await switchTheme(page, 'light')
  }
  finally {
    await page.request.post('/api/locations/suggestions-mode', { data: { unavailable: false } })
  }
})

test('a validation error keeps every typed value and focuses the summary', async ({ page }) => {
  const tenant = await seedTenant('transfer-invalid')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const dialog = await openForm(page)
  await dialog.getByLabel('Ime gosta').fill('Ana Ostaje')
  await dialog.getByLabel('Cijena (EUR)').fill('42,50')
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(dialog.getByLabel('Ime gosta')).toHaveValue('Ana Ostaje')
  await expect(dialog.getByLabel('Cijena (EUR)')).toHaveValue('42,50')
  await expect(dialog.getByLabel('Referenca naručitelja')).toBeVisible()
  await expect(page.locator('#transfer-form-summary')).toBeFocused()
  await expect(page.locator('#transfer-form-summary')).toHaveAttribute('role', 'alert')
})

test('a typed Client reference survives save, correction, and reload', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('transfer-reference')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await createdId(page, '/api/clients', { name: 'Agencija Referenca', kind: 'agency' })
  await createdId(page, '/api/locations', { name: 'Polazak Referenca', kind: 'address' })
  await createdId(page, '/api/locations', { name: 'Dolazak Referenca', kind: 'hotel' })
  const dialog = await openForm(page)
  await chooseMenu(page, dialog, 'Naručitelj', 'Agencija Referenca')
  await chooseMenu(page, dialog, 'Polazište', 'Polazak Referenca')
  await chooseMenu(page, dialog, 'Odredište', 'Dolazak Referenca')
  const day = operationalDay(page)
  await dialog.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
  await dialog.getByLabel('Ime gosta').fill('Ana Referenca')
  await dialog.getByLabel('Cijena (EUR)').fill('18')
  await chooseOption(page, dialog.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')
  await dialog.getByLabel('Referenca naručitelja').fill('V-19')
  await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Notifications (F8)' }).getByText('Zabilježeno.')).toBeVisible()
  // Recording opens this Ride, so the address settles on ?ride= before we leave it.
  await expect(page).toHaveURL(/[?&]ride=/)
  await expect(page.getByRole('article').getByRole('heading', { name: 'Ana Referenca' })).toBeVisible()
  await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()
  // The row action sits under this panel. Reload only once the panel is gone,
  // or a late `?ride=` opens it again and the click never lands.
  const detail = page.locator('#ride-detail')
  await expect(detail).toBeHidden()
  await expect(page).not.toHaveURL(/[?&]ride=/)

  await page.reload()
  await hydrated(page)
  await expect(detail).toBeHidden()
  await page.getByRole('button', { name: 'Radnje: Ana Referenca' }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  const correcting = page.getByRole('dialog')
  await expect(correcting.getByLabel('Referenca naručitelja')).toHaveValue('V-19')
  await correcting.getByLabel('Referenca naručitelja').fill('V-20')
  await correcting.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  await expect(correcting).toBeHidden()
  // The correction closes the panel. The row action is under it until it is gone.
  await expect(detail).toBeHidden()
  await expect(page).not.toHaveURL(/[?&]ride=/)

  await page.reload()
  await hydrated(page)
  await expect(detail).toBeHidden()
  await page.getByRole('button', { name: 'Radnje: Ana Referenca' }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  await expect(page.getByRole('dialog').getByLabel('Referenca naručitelja')).toHaveValue('V-20')
})

/**
 * A lost create (ADR-0035, issue #388). The request is stored, then the
 * response is dropped. The same entry key makes the retry one Transfer.
 */
async function dropNextCreateResponse(page: Page) {
  let dropped = false
  await page.route('**/api/transfers', async (route) => {
    if (dropped || route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    dropped = true
    // The server stores the Transfer. The browser never sees the answer.
    await route.fetch()
    await route.abort()
  })
}

test.describe('an already saved entry', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`a lost answer keeps the typed values and Razumijem opens the one Transfer (${theme})`, async ({ page }) => {
      test.setTimeout(120_000)
      const tenant = await seedTenant(`transfer-already-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await createdId(page, '/api/clients', { name: 'Agencija Ključ', kind: 'agency' })
      await createdId(page, '/api/locations', { name: 'Polazak Ključ', kind: 'address' })
      await createdId(page, '/api/locations', { name: 'Dolazak Ključ', kind: 'hotel' })
      const dialog = await openForm(page)
      await chooseMenu(page, dialog, 'Naručitelj', 'Agencija Ključ')
      await chooseMenu(page, dialog, 'Polazište', 'Polazak Ključ')
      await chooseMenu(page, dialog, 'Odredište', 'Dolazak Ključ')
      const day = operationalDay(page)
      await dialog.getByLabel('Vrijeme preuzimanja').fill(`${day}T12:00`)
      await dialog.getByLabel('Ime gosta').fill('Ana Prva')
      await dialog.getByLabel('Cijena (EUR)').fill('18')
      await chooseOption(page, dialog.getByRole('combobox', { name: 'Plaćanje' }), 'Gotovina')

      await dropNextCreateResponse(page)
      await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
      await expect(dialog.getByText('Transfer nije zabilježen. Pokušajte ponovno.')).toBeVisible()
      await dialog.getByLabel('Ime gosta').fill('Ana Druga')
      await page.unroute('**/api/transfers')

      await dialog.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
      const notice = dialog.getByRole('status').filter({ hasText: 'Ovaj transfer je već spremljen' })
      await expect(notice.getByText('Ovaj transfer je već spremljen')).toBeVisible()
      await expect(notice.getByText('Unos je spremljen ranije. Izmjene nakon toga nisu spremljene. Vidite ih ispod; unesite ih ispravkom spremljenog transfera.')).toBeVisible()
      await expect(dialog.getByLabel('Ime gosta')).toHaveValue('Ana Druga')
      await expect(dialog.getByLabel('Ime gosta')).toBeDisabled()
      await expect(dialog.getByLabel('Cijena (EUR)')).toHaveValue('18')
      await page.mouse.move(0, 0)
      await expectNoAxeViolations(page)

      await notice.getByRole('button', { name: 'Razumijem', exact: true }).click()
      // The slideover title and the detail heading both name the saved guest.
      await expect(page.getByRole('heading', { name: 'Ana Prva' }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Radnje: Ana Prva' })).toHaveCount(1)
      await expect(page.getByText('Ana Druga')).toHaveCount(0)
    })
  }

  test('the already-saved notice in English', async ({ page }) => {
    test.setTimeout(120_000)
    const tenant = await seedTenant('transfer-already-en')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await switchLocale(page, 'en')
    await createdId(page, '/api/clients', { name: 'Agency Key', kind: 'agency' })
    await createdId(page, '/api/locations', { name: 'Start Key', kind: 'address' })
    await createdId(page, '/api/locations', { name: 'End Key', kind: 'hotel' })
    await page.goto('/transfers')
    await hydrated(page)
    await page.getByRole('button', { name: 'Record a transfer', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await chooseMenu(page, dialog, 'Client', 'Agency Key')
    await chooseMenu(page, dialog, 'Where it starts', 'Start Key')
    await chooseMenu(page, dialog, 'Where it ends', 'End Key')
    const day = operationalDay(page)
    await dialog.getByLabel('Pickup time').fill(`${day}T12:00`)
    await dialog.getByLabel('Guest name').fill('Ana First')
    await dialog.getByLabel('Price (EUR)').fill('18')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Payment' }), 'Cash')

    await dropNextCreateResponse(page)
    await dialog.getByRole('button', { name: 'Record transfer', exact: true }).click()
    await expect(dialog.getByText('The transfer was not recorded. Try again.')).toBeVisible()
    await page.unroute('**/api/transfers')
    await dialog.getByRole('button', { name: 'Record transfer', exact: true }).click()
    const notice = dialog.getByRole('status').filter({ hasText: 'This Transfer is already saved' })
    await expect(notice.getByText('This Transfer is already saved')).toBeVisible()
    await expect(notice.getByText('This entry was saved earlier. Changes made after that were not saved. They are shown below; enter them as a correction of the saved Transfer.')).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Got it', exact: true })).toBeVisible()
    await notice.getByRole('button', { name: 'Got it', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Ana First' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Actions: Ana First' })).toHaveCount(1)
  })
})

test.describe('@phone', () => {
  test('quick add suggestions pass axe on a phone', async ({ page }) => {
    test.setTimeout(120_000)
    const tenant = await seedTenant('transfer-place-pick-phone')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await useTheme(page, 'dark')
    await page.goto('/transfers')
    await hydrated(page)
    await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
    const dialog = page.getByRole('dialog').or(page.getByRole('region', { name: 'Zabilježi transfer' }))
    await createFromSelect(page, dialog, 'Polazište', 'Hotel Telefon')
    await chooseOption(page, dialog.getByRole('combobox', { name: 'Vrsta' }), 'Hotel')
    const phoneName = dialog.getByLabel('Ime', { exact: true })
    await expect(phoneName).toBeFocused()
    await phoneName.press('End')
    await phoneName.pressSequentially(' 2')
    await expect(dialog.getByRole('option', { name: 'Hotel Telefon 2, Dubrovnik' })).toBeVisible()
    await page.mouse.move(0, 0)
    await expectNoAxeViolations(page)
    await dialog.getByLabel('Adresa', { exact: true }).pressSequentially('Obala 6')
    await expect(dialog.getByRole('option', { name: 'Obala 6, Dubrovnik' })).toBeVisible()
    await page.mouse.move(0, 0)
    await expectNoAxeViolations(page)
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`the transfer form follows ${theme} and passes axe`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = (page.viewportSize()?.width ?? 1280) < 1024
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`transfer-form-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await page.goto('/transfers')
      await hydrated(page)
      await page.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
      const panel = phone
        ? page.getByRole('dialog')
        : page.getByRole('region', { name: 'Zabilježi transfer' })
      await expect(panel.getByRole('button', { name: 'Naručitelj', exact: true })).toBeVisible()
      await expect(panel.getByLabel('Ime gosta')).toBeVisible()
      await expect(panel.getByLabel('Referenca naručitelja')).toBeVisible()
      await expect(panel.getByLabel('Broj leta')).toBeHidden()
      await panel.getByRole('button', { name: 'Više', exact: true }).click()
      await expect(panel.getByLabel('Broj leta')).toBeVisible()
      await expect(panel.getByRole('checkbox', { name: 'Aerodromsko preuzimanje' })).toBeVisible()
      // The pointer stays on the last click. A hovered primary button uses
      // the /75 fill, which is below 4.5:1, so move it off before axe.
      await page.mouse.move(0, 0)
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await page.getByRole('button', { name: 'Record a transfer', exact: true }).click()
        const english = page.getByRole('region', { name: 'Record a transfer' }).or(page.getByRole('dialog'))
        await expect(english.getByLabel('Guest name')).toBeVisible()
        await expect(english.getByLabel('Client reference')).toBeVisible()
        await expect(english.getByLabel('Flight number')).toBeHidden()
        await english.getByRole('button', { name: 'More', exact: true }).click()
        await expect(english.getByLabel('Flight number')).toBeVisible()
        await page.mouse.move(0, 0)
        await expectNoAxeViolations(page)
      }
    })
  }
})
