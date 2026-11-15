import type { Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedMember, seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, signOut, switchLocale, switchTheme, useTheme } from './fixtures/ui'

/**
 * Transfer day header (issue #564, ADR-0060). Viewports are set in the
 * test. The Playwright projects stay as they are.
 */

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)
const MISSING = '00000000-0000-4000-8000-000000000099'

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function record(page: Page, guest: string, day: string, wall: string, spot: {
  clientId: string
  startLocationId: string
  endLocationId: string
}) {
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId: spot.clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
      startLocationId: spot.startLocationId,
      endLocationId: spot.endLocationId,
      passengerCount: 1,
      guestName: guest,
      price: 10,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const body = await recorded.json() as { ride: { id: string } }
  return body.ride.id
}

/** Names of the header controls in tab order, stopping at the first focus outside it. */
async function tabThroughHeader(page: Page): Promise<string[]> {
  const names: string[] = []
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab')
    const name = await page.evaluate(() => {
      const node = document.activeElement
      if (!(node instanceof HTMLElement) || !node.closest('header'))
        return ''
      const explicit = node.getAttribute('aria-label')
      if (explicit)
        return explicit
      const fromLabel = 'labels' in node && node.labels instanceof NodeList
        ? node.labels[0]?.textContent
        : ''
      if (fromLabel)
        return fromLabel.trim()
      const labelledBy = node.getAttribute('aria-labelledby')
      if (labelledBy) {
        const text = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? '').join(' ')
        if (text.trim() !== '')
          return text.trim()
      }
      return (node.textContent || '').replace(/\s+/g, ' ').trim()
    })
    if (name === '')
      break
    names.push(name)
  }
  return names
}

async function noPageScroll(page: Page) {
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  expect(fits).toBe(true)
}

test('chips stay blank and the list is busy until the day loads', async ({ page }) => {
  const tenant = await seedTenant('header-busy')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/api/transfers?*', async (route) => {
    await gate
    await route.continue()
  })
  try {
    await page.goto('/transfers')
    await expect(page.locator('#transfer-day-list')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByRole('button', { name: 'Sve', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Sve \(/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Hitno', exact: true })).toBeVisible()
  }
  finally {
    release()
  }
  await expect(page.getByRole('button', { name: /^Sve \(/ })).toBeVisible()
  await expect(page.locator('#transfer-day-list')).not.toHaveAttribute('aria-busy', 'true')
})

test('desktop header groups the day, the view, the filters, and the tools', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1366, height: 768 })
  const tenant = await seedTenant('header-desktop')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const clientId = await createdId(page, '/api/clients', { name: 'Agencija Ana', kind: 'agency' })
  const otherId = await createdId(page, '/api/clients', { name: 'Hotel Ivo', kind: 'hotel' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Zaglavlje', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Zaglavlje', kind: 'hotel' })
  await createdId(page, '/api/drivers', {
    name: 'Marko Filter',
    kind: 'own',
    phone: '+385910000564',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  const day = addCalendarDays(operationalDay(page), -1)
  const spot = { clientId, startLocationId, endLocationId }
  // Yesterday and unassigned, so this Ride is urgent. The finished one is not,
  // which lets Hitno show fewer rows than the day once the search is cleared.
  await record(page, 'Hitni Skriven', day, '09:00', spot)
  const finished = await record(page, 'Mirni Ostaje', day, '15:00', { ...spot, clientId: otherId })
  // Cancelled is on the day and is not urgent, so Hitno is a shorter list than the day.
  const cancelled = await page.request.post(`/api/rides/${finished}/cancel`, { data: {} })
  if (!cancelled.ok())
    throw new Error(`${cancelled.status()} ${await cancelled.text()}`)

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await expect(page.getByRole('button', { name: /^Hitno \(/ })).toBeVisible()

  const skip = page.getByRole('link', { name: 'Preskoči na vožnje' })
  await skip.focus()
  await expect(skip).toBeFocused()
  const walked = await tabThroughHeader(page)
  // A date input is one control. Chromium tabs its day, month, and year parts.
  const order = walked.filter((name, index) => name !== 'Dan' || walked[index - 1] !== 'Dan')
  const expected = [
    'Prethodni dan',
    'Danas',
    'Sljedeći dan',
    'Dan',
    /^Sve /,
    /^Hitno /,
    /^Upozorenja /,
    /^Nedodijeljeno /,
    /^Čeka prihvat /,
    /^U tijeku /,
    /^Zatvoreno /,
    /^Za fakturiranje /,
    'Traži u danu',
    'Filtri',
    'Naručitelj',
    'Vozač',
    'Vozilo',
    'Podizvođač',
    'Stanje vožnje',
    'Treba pažnju',
    'Osvježi',
    'Automatsko osvježavanje',
    'Ispiši dan',
    'Izvoz CSV',
  ]
  expect(order.slice(0, expected.length).map((name, index) => {
    const wanted = expected[index]!
    return typeof wanted === 'string' ? name === wanted : wanted.test(name)
  }), order.join(' | ')).toEqual(expected.map(() => true))
  await skip.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Transferi' })).toBeFocused()

  const filters = page.getByRole('button', { name: 'Filtri', exact: true })
  await expect(filters).toHaveAttribute('aria-expanded', 'true')
  await expect(filters).toHaveAttribute('aria-controls', 'transfer-day-filters')
  await expect(page.getByRole('button', { name: 'Ispiši dan', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Izvoz CSV', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Alati', exact: true })).toHaveCount(0)
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await switchTheme(page, 'dark')
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await switchTheme(page, 'light')

  await filters.click()
  await expect(filters).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Naručitelj', exact: true })).toBeHidden()
  await page.reload()
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'Filtri', exact: true })).toHaveAttribute('aria-expanded', 'false')
  const other = await seedMember(tenant.tenantId, 'dispatcher', 'Drugi')
  await signOut(page)
  await signIn(page, other.email, other.password, tenant.name)
  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'Filtri', exact: true })).toHaveAttribute('aria-expanded', 'true')

  await chooseOption(page, page.getByRole('button', { name: 'Naručitelj', exact: true }), 'Agencija Ana')
  await chooseOption(page, page.getByRole('button', { name: 'Vozač', exact: true }), 'Marko Filter')
  const summary = page.getByRole('group', { name: 'Aktivni filtri' })
  await expect(summary.getByText('Naručitelj: Agencija Ana')).toBeVisible()
  await expect(summary.getByText('Vozač: Marko Filter')).toBeVisible()
  await summary.getByRole('button', { name: 'Ukloni filtar: Naručitelj: Agencija Ana', exact: true }).click()
  await expect(summary.getByRole('button', { name: 'Ukloni filtar: Vozač: Marko Filter', exact: true })).toBeFocused()
  await summary.getByRole('button', { name: 'Ukloni filtar: Vozač: Marko Filter', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Filtri', exact: true })).toBeFocused()

  await page.goto(`/transfers?day=${day}&filter=urgent&search=nema-takvog`)
  await hydrated(page)
  await expect(page.locator('#transfer-day-hidden-urgent')).toContainText(/Hitno skriveno filtrima: \d+\./)
  await expect(page.locator('#transfer-day-hidden-urgent')).not.toHaveAttribute('aria-live', /./)
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await expect(page.getByRole('button', { name: /^Hitno \(/ })).toHaveAttribute('aria-describedby', 'transfer-day-hidden-urgent')
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await switchTheme(page, 'dark')
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await switchTheme(page, 'light')
  const spoken = page.locator('[aria-live="polite"]').filter({ hasText: 'Prikazano' })
  await expect(spoken).toHaveCount(0)
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await expect(spoken).toHaveCount(0)
  await page.getByRole('group', { name: 'Aktivni filtri' }).getByRole('button', { name: 'Očisti filtre', exact: true }).click()
  await expect(page).toHaveURL(/filter=urgent/)
  await expect(page).not.toHaveURL(/search=/)
  await expect(page.locator('#transfer-day-hidden-urgent')).toHaveCount(0)
  await expect(spoken).toContainText(/Prikazano: \d+ od \d+/)

  await page.getByRole('searchbox', { name: 'Traži u danu' }).fill('nema-takvog')
  await expect(page.getByText('Nema vožnji za ovaj filtar.')).toBeVisible()
  await page.getByRole('paragraph').filter({ hasText: 'Nema vožnji za ovaj filtar.' }).getByRole('button', { name: 'Očisti filtre', exact: true }).click()
  await expect(page).not.toHaveURL(/filter=/)
  await expect(page).not.toHaveURL(/search=/)

  await page.goto(`/transfers?day=${day}&filter=done`)
  await hydrated(page)
  await expect(page.getByRole('button', { name: /^Obavljeno \(/ })).toHaveAttribute('aria-pressed', 'true')
  await page.goto(`/transfers?day=${day}&client=${MISSING}`)
  await hydrated(page)
  await expect(page.getByRole('button', { name: 'Ukloni filtar: Naručitelj: Nepoznat naručitelj', exact: true })).toBeVisible()
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)

  await switchTheme(page, 'dark')
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await switchLocale(page, 'en')
  await expect(page.getByRole('group', { name: 'View' })).toBeVisible()
  await expect(page.getByText('Client: Unknown client')).toBeVisible()
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)

  await page.setViewportSize({ width: 1024, height: 768 })
  for (const name of ['All', 'Urgent', 'Warnings', 'Unassigned', 'Waiting on acceptance', 'In progress', 'Closed', 'To invoice']) {
    const chip = page.getByRole('button', { name: new RegExp(`^${name} \\(\\d+\\)$`) })
    await expect(chip).toBeVisible()
    const box = await chip.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.x + box!.width).toBeLessThanOrEqual(1024)
  }
  await noPageScroll(page)
})

test('phone header keeps the list on screen and the fields in a sheet', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 360, height: 800 })
  const tenant = await seedTenant('header-phone')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const clientId = await createdId(page, '/api/clients', { name: 'Agencija Ana', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Telefon', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Telefon', kind: 'hotel' })
  const day = addCalendarDays(operationalDay(page), -1)
  const spot = { clientId, startLocationId, endLocationId }
  await record(page, 'Hitni Telefon', day, '09:00', spot)
  await record(page, 'Mirni Telefon', day, '16:00', spot)
  for (let hour = 10; hour <= 20; hour += 1)
    await record(page, `Gost ${hour}`, day, `${String(hour).padStart(2, '0')}:00`, spot)

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await expect(page.getByText('Pogled', { exact: true })).toBeHidden()
  await expect(page.getByRole('group', { name: 'Pogled' })).toBeVisible()
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await switchTheme(page, 'dark')
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await switchTheme(page, 'light')

  const filters = page.getByRole('button', { name: 'Filtri', exact: true })
  await filters.click()
  const sheet = page.getByRole('dialog', { name: 'Filtri' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Naručitelj', exact: true })).toBeFocused()
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('hidden')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await expect(filters).toBeFocused()

  await filters.click()
  await sheet.getByRole('button', { name: 'Zatvori', exact: true }).click()
  await expect(sheet).toBeHidden()
  await expect(filters).toBeFocused()

  await filters.click()
  await sheet.getByRole('button', { name: /^Prikaži vožnje: \d+$/ }).click()
  await expect(sheet).toBeHidden()

  const search = page.getByRole('searchbox', { name: 'Traži u danu' })
  await search.fill('gost')
  await expect(page).toHaveURL(/search=gost/)
  await page.getByRole('button', { name: /^Filtri/ }).click()
  await sheet.getByRole('checkbox', { name: 'Treba pažnju' }).click()
  await expect(page).toHaveURL(/attention=1/)
  await page.goBack()
  await expect(sheet).toBeHidden()
  await expect(page).not.toHaveURL(/attention=/)
  await expect(page).toHaveURL(/search=gost/)

  const scrolled = await page.evaluate(() => {
    const field = document.getElementById('transfer-day-search')
    let node = field?.parentElement ?? null
    while (node) {
      const overflow = getComputedStyle(node).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 8) {
        node.scrollTop = node.scrollHeight
        return node.scrollTop
      }
      node = node.parentElement
    }
    return 0
  })
  expect(scrolled).toBeGreaterThan(0)
  await expect(search).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Prethodni dan' })).not.toBeInViewport()
  const closed = page.getByRole('button', { name: /^Zatvoreno \(/ })
  await closed.click()
  await expect(closed).toBeInViewport()

  await page.getByRole('button', { name: 'Alati', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Ispiši dan', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Izvoz CSV', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)

  await search.fill('nema-takvog')
  await expect(page.getByText(/Hitno skriveno filtrima: \d+\./)).toBeVisible()
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: /^Filtri/ }).click()
  await expect(sheet).toBeVisible()
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await sheet.getByRole('button', { name: /^Prikaži vožnje/ }).click()

  await switchTheme(page, 'dark')
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: /^Filtri/ }).click()
  await expect(sheet).toBeVisible()
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
  await sheet.getByRole('button', { name: /^Prikaži vožnje/ }).click()
  await switchLocale(page, 'en')
  const waiting = page.getByRole('button', { name: /^Waiting on acceptance \(/ })
  await waiting.scrollIntoViewIfNeeded()
  const clipped = await waiting.evaluate(element => element.scrollWidth > element.clientWidth + 1)
  expect(clipped).toBe(false)
  await expect(waiting).toBeInViewport()
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)

  await page.setViewportSize({ width: 320, height: 800 })
  await noPageScroll(page)
})
