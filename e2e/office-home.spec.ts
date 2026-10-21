import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { recordTransfer } from './fixtures/record-transfer'
import { plantFailedWorkOrder, seedMember, seedTenant } from './fixtures/seed'
import { signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

function watchReads(page: Page) {
  const reads = { office: 0, documents: 0 }
  page.on('request', (request) => {
    if (request.method() !== 'GET')
      return
    const path = new URL(request.url()).pathname
    if (path === '/api/office-home')
      reads.office += 1
    if (path === '/api/expiring-documents')
      reads.documents += 1
  })
  return reads
}

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

test('a signed-out visitor gets the sign-in form and no office lists', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toHaveCount(0)
  await expect(page.getByLabel('E-pošta')).toBeVisible()
})

test('office home loads both reads, refreshes after 60 seconds while visible, and a keyboard refresh loads both again', async ({ page }) => {
  const tenant = await seedTenant('home-refresh')
  const reads = watchReads(page)
  await installOfficeClock(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toBeVisible()
  const attention = page.getByRole('region', { name: 'Pozornost' })
  const unassigned = page.getByRole('region', { name: 'Nedodijeljeno' })
  const waiting = page.getByRole('region', { name: 'Čeka prihvat' })
  const progress = page.getByRole('region', { name: 'U tijeku' })
  await expect(attention).toContainText('Nema hitnih vožnji. Ostale vožnje su na popisima ispod.')
  await expect(page.getByRole('heading', { name: /Neuspjeli mailovi/ })).toHaveCount(0)
  await expect(unassigned).toContainText('Nema nedodijeljenih vožnji. Novi transfer otvorite na Transferima.')
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Početna, 0', exact: true })).toBeVisible()
  await expect(waiting).toContainText('Nema vožnji koje čekaju prihvat. Dodijeljena vožnja čeka ovdje dok je vozač ne prihvati.')
  await expect(progress).toContainText('Nema vožnji u tijeku. Započeta vožnja pojavit će se ovdje.')
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hrvatski' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Svijetla', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Tamna', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prema uređaju', exact: true })).toHaveCount(0)
  await expect(page.getByRole('switch', { name: 'Automatsko osvježavanje' })).toBeChecked()
  await expect(page.getByText(/Ažurirano u \d{2}:\d{2}/)).toBeVisible()
  await expect.poll(() => reads.office).toBeGreaterThan(0)
  await expect.poll(() => reads.documents).toBeGreaterThan(0)
  // Pause after the page is up, then arm a fresh minute so 59 s cannot be early.
  await pauseOfficeClock(page)
  await rearmAutomaticRefresh(page)

  const officeAfterOpen = reads.office
  const documentsAfterOpen = reads.documents
  await page.clock.fastForward(59_000)
  expect(reads.office).toBe(officeAfterOpen)
  expect(reads.documents).toBe(documentsAfterOpen)

  await page.clock.fastForward(1_000)
  await expect.poll(() => reads.office).toBe(officeAfterOpen + 1)
  await expect.poll(() => reads.documents).toBeGreaterThan(documentsAfterOpen)
  await expect(page.getByText('Ažurirano u 12:01')).toBeVisible()

  const officeAfterTick = reads.office
  const documentsAfterTick = reads.documents
  const refresh = page.getByRole('button', { name: 'Osvježi', exact: true })
  await refresh.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => reads.office).toBe(officeAfterTick + 1)
  await expect.poll(() => reads.documents).toBeGreaterThan(documentsAfterTick)
})

test('the lists show the alarm, every price, and the flight as text, in both locales and both themes', async ({ page }) => {
  const tenant = await seedTenant('home-lists')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Agencija Mora', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Zračna luka Dubrovnik', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Excelsior', kind: 'hotel' },
  }))
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Vozač',
      kind: 'own',
      phone: '+38595555146',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const mustAccept = await page.request.patch(`/api/drivers/${driverId}`, { data: { mustAccept: true } })
  expect(mustAccept.ok()).toBeTruthy()
  const plainDriverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Ana Slobodna',
      kind: 'own',
      phone: '+38595555147',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU146AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))

  const now = new Date()
  const places = { clientId, startLocationId, endLocationId }
  await record(page, 'Alarm Ana', new Date(now.getTime() + 2 * 60 * 60 * 1000), places, {
    price: 42.5,
    payment: 'cash',
    flightNumber: 'OU 384',
    tabla: 'GOSPOĐA HORVAT',
  })
  await record(page, 'Card Ivo', new Date(now.getTime() + 3 * 60 * 60 * 1000), places, {
    price: 18,
    payment: 'card',
  })
  await record(page, 'Agency Eva', new Date(now.getTime() + 3 * 60 * 60 * 1000 + 60 * 1000), places, {
    price: 0,
    payment: 'invoice_to_agency',
  })
  const oldDay = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', now), -2)
  await record(page, 'Old Luka', instantFromWallClock(`${oldDay}T12:00`, 'Europe/Zagreb'), places, {
    price: 10,
    payment: 'cash',
  })
  const waiting = await record(page, 'Waiting Nika', new Date(now.getTime() + 60 * 60 * 1000), places, {
    price: 10,
    payment: 'cash',
  })
  const assigned = await page.request.post(`/api/rides/${waiting}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()
  const openRide = await record(page, 'Open Lara', new Date(now.getTime() - 90 * 60 * 1000), places, {
    price: 10,
    payment: 'cash',
  })
  const freshRide = await record(page, 'Fresh Ivo', new Date(now.getTime() - 20 * 60 * 1000), places, {
    price: 10,
    payment: 'cash',
  })
  const openAssigned = await page.request.post(`/api/rides/${openRide}/assign`, {
    data: { version: 0, driverId: plainDriverId, vehicleId },
  })
  const freshAssigned = await page.request.post(`/api/rides/${freshRide}/assign`, {
    data: { version: 0, driverId: plainDriverId, vehicleId },
  })
  expect(openAssigned.ok()).toBeTruthy()
  expect(freshAssigned.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()

  // Price, payment, flight, and the tabla moved off the Home row. The row
  // keeps the route, the Client, the short urgent text, and one action.
  const attention = page.getByRole('region', { name: 'Pozornost' })
  const alarm = attention.getByRole('listitem').filter({ hasText: 'Alarm Ana' })
  await expect(alarm).toContainText('Nedodijeljeno < 4 h')
  await expect(alarm).toContainText('Agencija Mora')
  await expect(alarm).toContainText('1 putnika')
  await expect(alarm).toContainText('Zračna luka Dubrovnik')
  await expect(alarm).toContainText('Hotel Excelsior')
  await expect(alarm.getByRole('link', { name: /Dodijeli/ })).toHaveAttribute('href', /ride=/)
  await expect(attention.getByRole('listitem').filter({ hasText: 'Old Luka' })).toContainText('Prošlo preuzimanje')
  await expect(page.getByRole('region', { name: 'Nedodijeljeno' })).toContainText('Nema nedodijeljenih vožnji. Novi transfer otvorite na Transferima.')

  const waitingList = page.getByRole('region', { name: 'Čeka prihvat' })
  const waitingRow = waitingList.getByRole('listitem').filter({ hasText: 'Waiting Nika' })
  await expect(waitingRow).toContainText('Marko Vozač')
  await expect(waitingRow).toContainText('DU146AA')
  await expect(waitingRow).not.toContainText('Nedodijeljeno < 4 h')
  await expect(waitingRow).not.toContainText('Nije zatvoreno')
  await expect(waitingRow.getByRole('link', { name: /Potvrdi telefonom/ })).toBeVisible()

  const progress = page.getByRole('region', { name: 'U tijeku' })
  await expect(progress.getByRole('listitem').filter({ hasText: 'Open Lara' })).toHaveCount(0)
  const openRow = attention.getByRole('listitem').filter({ hasText: 'Open Lara' })
  const freshRow = progress.getByRole('listitem').filter({ hasText: 'Fresh Ivo' })
  await expect(openRow).toContainText('Nije zatvoreno')
  await expect(openRow).toContainText('Ana Slobodna')
  await expect(freshRow).toBeVisible()
  await expect(freshRow).not.toContainText('Nije zatvoreno')

  const counts = page.getByRole('region', { name: 'Brojevi za operativni dan' })
  await expect(counts).toContainText('Vožnje')
  await expect(counts).toContainText('Dodijeljeno, nije krenulo')
  await expect(counts).toContainText('Obavljeno')
  await expect(counts).toContainText('Nedolazak')
  await expect(counts).toContainText('Otkazano')
  await expect(counts).not.toContainText('EUR')
  // Each Ride is one action link. Mark lists inside the row are list items too.
  const urgentRows = await attention.getByRole('link').count()
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: `Početna, ${urgentRows}`, exact: true })).toBeVisible()

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { name: 'Counts for the operational day' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Attention' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Automatic refresh' })).toBeChecked()
  await expect(page.getByText(/Updated at \d{2}:\d{2}/)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Attention' }).getByRole('listitem').filter({ hasText: 'Alarm Ana' })).toContainText('Unassigned < 4 h')
  await expect(page.getByRole('region', { name: 'Attention' }).getByRole('listitem').filter({ hasText: 'Open Lara' })).toContainText('Not closed')
  await expect(page.getByRole('region', { name: 'In progress' }).getByRole('listitem').filter({ hasText: 'Fresh Ivo' })).not.toContainText('Not closed')
  await expect(page.getByRole('button', { name: 'English' })).toHaveCount(0)

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('region', { name: 'Attention' }).getByRole('listitem').filter({ hasText: 'Alarm Ana' })).toContainText('Unassigned < 4 h')
  await expect(page.getByRole('region', { name: 'Attention' }).getByRole('listitem').filter({ hasText: 'Open Lara' })).toContainText('Not closed')
  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.getByRole('region', { name: 'Attention' }).getByRole('listitem').filter({ hasText: 'Alarm Ana' })).toBeVisible()
})

test('a hidden tab sends no request and a visible tab reloads at once', async ({ page }) => {
  const tenant = await seedTenant('home-visibility')
  const reads = watchReads(page)
  await installOfficeClock(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect.poll(() => reads.office).toBeGreaterThan(0)
  await expect.poll(() => reads.documents).toBeGreaterThan(0)
  await pauseOfficeClock(page)

  await setTabVisibility(page, 'hidden')
  const officeHidden = reads.office
  const documentsHidden = reads.documents
  await page.clock.fastForward(120_000)
  expect(reads.office).toBe(officeHidden)
  expect(reads.documents).toBe(documentsHidden)

  await setTabVisibility(page, 'visible')
  await expect.poll(() => reads.office).toBeGreaterThan(officeHidden)
  await expect.poll(() => reads.documents).toBeGreaterThan(documentsHidden)
})

test('switching automatic refresh off stops the timer and Osvježi still works', async ({ page }) => {
  const tenant = await seedTenant('home-automatic')
  const reads = watchReads(page)
  await installOfficeClock(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect.poll(() => reads.office).toBeGreaterThan(0)
  await pauseOfficeClock(page)

  const automatic = page.getByRole('switch', { name: 'Automatsko osvježavanje' })
  await automatic.click()
  await expect(automatic).not.toBeChecked()
  const officePaused = reads.office
  const documentsPaused = reads.documents
  await page.clock.fastForward(120_000)
  expect(reads.office).toBe(officePaused)
  expect(reads.documents).toBe(documentsPaused)

  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await expect.poll(() => reads.office).toBeGreaterThan(officePaused)
  await expect.poll(() => reads.documents).toBeGreaterThan(documentsPaused)
  await expect(automatic).not.toBeChecked()
})

test('a failed refresh keeps the rows and shows the last time', async ({ page }) => {
  const tenant = await seedTenant('home-stale')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const places = await placesFor(page)
  await record(page, 'Stalna Ana', new Date(Date.now() + 3 * 60 * 60 * 1000), places, {
    price: 10,
    payment: 'cash',
  })
  await page.getByRole('switch', { name: 'Automatsko osvježavanje' }).click()
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  const row = page.getByRole('region', { name: 'Pozornost' }).getByRole('listitem').filter({ hasText: 'Stalna Ana' })
  await expect(row).toBeVisible()
  const status = page.getByText(/Ažurirano u \d{2}:\d{2}/)
  const time = (await status.textContent())?.match(/\d{2}:\d{2}/)?.[0]
  expect(time).toBeTruthy()

  await page.route('**/api/office-home', route => route.abort())
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await expect(page.getByText(`Nije osvježeno, zadnje u ${time}`)).toBeVisible()
  await expect(row).toBeVisible()
  await expect(page.getByText('Početna se nije mogla učitati. Pokušajte ponovno.')).toHaveCount(0)
})

test('a refresh leaves scroll and focus where they were', async ({ page }) => {
  const tenant = await seedTenant('home-still')
  const reads = watchReads(page)
  await installOfficeClock(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect.poll(() => reads.office).toBeGreaterThan(0)
  await pauseOfficeClock(page)
  await rearmAutomaticRefresh(page)
  const officeAfterOpen = reads.office

  const scrolled = await scrollWorkingPanel(page)
  expect(scrolled).toBeGreaterThan(0)
  const automatic = page.getByRole('switch', { name: 'Automatsko osvježavanje' })
  await automatic.focus()
  await page.clock.fastForward(60_000)
  await expect.poll(() => reads.office).toBeGreaterThan(officeAfterOpen)
  await expect(automatic).toBeFocused()
  expect(await scrollTop(page)).toBe(scrolled)
})

test('a new urgent item is announced once and an unchanged refresh says nothing', async ({ page }) => {
  const tenant = await seedTenant('home-urgent')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const live = page.locator('main [aria-live="polite"]')
  await expect(live).toHaveText('')
  await page.getByRole('switch', { name: 'Automatsko osvježavanje' }).click()

  const places = await placesFor(page)
  await record(page, 'Hitna Mia', new Date(Date.now() + 2 * 60 * 60 * 1000), places, {
    price: 10,
    payment: 'cash',
  })
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Pozornost' }).getByRole('listitem').filter({ hasText: 'Hitna Mia' })).toContainText('Nedodijeljeno < 4 h')
  await expect(live).toHaveText('Nova hitna stavka')

  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  await expect(live).toHaveText('')
  await expect(page.getByRole('region', { name: 'Pozornost' }).getByRole('listitem').filter({ hasText: 'Hitna Mia' })).toBeVisible()
})

test('expiring documents still show when the office read fails', async ({ page }) => {
  const tenant = await seedTenant('home-office-fail')
  await page.route('**/api/office-home', route => route.abort())
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect(page.getByText('Početna se nije mogla učitati. Pokušajte ponovno.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expect(page.getByText('Nema isteklih dokumenata ni dokumenata koji istječu u sljedećih 30 dana.')).toBeVisible()
})

test('the office lists still show when the document read fails', async ({ page }) => {
  const tenant = await seedTenant('home-docs-fail')
  await page.route('**/api/expiring-documents', route => route.abort())
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Pozornost' })).toContainText('Nema hitnih vožnji. Ostale vožnje su na popisima ispod.')
  await expect(page.getByRole('region', { name: 'Nedodijeljeno' })).toContainText('Nema nedodijeljenih vožnji. Novi transfer otvorite na Transferima.')
  await expect(page.getByText('Dokumente nije bilo moguće učitati. Pokušajte ponovno.')).toBeVisible()
})

test('a driver does not see the lists or counts and the office read is not requested', async ({ page }) => {
  const tenant = await seedTenant('home-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  const reads = watchReads(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('heading', { name: 'Sljedeća vožnja' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Dokumenti koji istječu' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Osvježi', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Osvježi dokumente' })).toHaveCount(0)
  expect(reads.office).toBe(0)
  await expect.poll(() => reads.documents).toBeGreaterThan(0)
})

// @phone: the phone project runs this block as well as the desktop project.
test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`home follows ${theme} and passes axe`, async ({ page }) => {
      const tenant = await seedTenant(`home-axe-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await expect(page.getByRole('heading', { name: 'Pozornost' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: /^Početna, \d+$/ })).toBeVisible()
      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('heading', { name: 'Attention' })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }

  test('each balance count opens Transfers for today with that filter', async ({ page }) => {
    const tenant = await seedTenant('home-count-links')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const counts = page.getByRole('region', { name: 'Brojevi za operativni dan' })
    await expect(counts).toBeVisible()
    const parts = [
      ['Vožnje', null],
      ['Nedodijeljeno', 'unassigned'],
      ['Čeka prihvat', 'waiting'],
      ['Dodijeljeno, nije krenulo', 'assignedNotStarted'],
      ['U tijeku', 'inProgress'],
      ['Predano podizvođaču', 'handedOff'],
      ['Obavljeno', 'done'],
      ['Nedolazak', 'noShow'],
      ['Otkazano', 'cancelled'],
    ] as const
    for (const [label, filter] of parts) {
      await counts.getByRole('link', { name: new RegExp(`^${label} \\d+$`) }).click()
      await expect(page).toHaveURL(/\/transfers\?/)
      await expect(page).toHaveURL(/day=\d{4}-\d{2}-\d{2}/)
      if (filter)
        await expect(page).toHaveURL(new RegExp(`filter=${filter}`))
      else
        expect(new URL(page.url()).searchParams.get('filter')).toBeNull()
      await page.goto('/')
      await expect(counts).toBeVisible()
    }
  })
})

async function installOfficeClock(page: Page) {
  // A minute before the pause point, so page load can run its own timers.
  await page.clock.install({ time: new Date('2026-10-15T09:59:00.000Z') })
}

async function pauseOfficeClock(page: Page) {
  // 10:00 UTC is 12:00 in Europe/Zagreb on this date.
  await page.clock.pauseAt(new Date('2026-10-15T10:00:00.000Z'))
}

async function rearmAutomaticRefresh(page: Page) {
  const automatic = page.getByRole('switch', { name: 'Automatsko osvježavanje' })
  await automatic.click()
  await expect(automatic).not.toBeChecked()
  await automatic.click()
  await expect(automatic).toBeChecked()
}

async function setTabVisibility(page: Page, state: 'visible' | 'hidden') {
  await page.evaluate((next) => {
    const view = document as Document & { __tpVisibility?: 'visible' | 'hidden' }
    if (!Object.hasOwn(document, 'visibilityState')) {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get() {
          return view.__tpVisibility ?? 'visible'
        },
      })
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get() {
          return (view.__tpVisibility ?? 'visible') === 'hidden'
        },
      })
    }
    view.__tpVisibility = next
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

async function scrollWorkingPanel(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main)
      throw new Error('missing main')
    const filler = document.createElement('div')
    filler.style.height = '2400px'
    main.append(filler)
    let node: HTMLElement | null = main.parentElement
    while (node) {
      const style = getComputedStyle(node)
      if (/auto|scroll/.test(style.overflowY)) {
        node.scrollTop = 360
        if (node.scrollTop > 0)
          return node.scrollTop
      }
      node = node.parentElement
    }
    throw new Error('missing scroll container')
  })
}

async function scrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.querySelector('main')
    let node: HTMLElement | null = main?.parentElement ?? null
    while (node) {
      const style = getComputedStyle(node)
      if (/auto|scroll/.test(style.overflowY) && node.scrollTop > 0)
        return node.scrollTop
      node = node.parentElement
    }
    return 0
  })
}

test('a failed work order sits below Attention and Send again clears it, in both themes and on a phone', async ({ page }) => {
  // The automatic attempts take about 36 minutes. This plants the failed row
  // they would leave, then checks the block and one resend.
  const tenant = await seedTenant('home-failed-mail')
  const address = `e2e-failed-${tenant.tenantId.slice(0, 8)}@example.test`
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const places = await placesFor(page)
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Ana Slobodna',
      kind: 'own',
      phone: '+38595555180',
      email: address,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU180AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const rideId = await record(page, 'Gost Klara', new Date(Date.now() + 4 * 60 * 60 * 1000), places, {
    price: 10,
    payment: 'cash',
  })
  expect((await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })).ok()).toBeTruthy()
  await plantFailedWorkOrder(tenant.tenantId, { rideId, driverId })
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()

  const block = page.getByRole('region', { name: /Neuspjeli mailovi \(1\)/ })
  await expect(block).toBeVisible()
  await expect(block).toContainText('Ana Slobodna')
  await expect(block).toContainText('Zračna luka Dubrovnik')
  await expect(block).toContainText('Hotel Excelsior')
  await expect(block).not.toContainText(address)
  await expect(page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Početna, 0', exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  const resend = block.getByRole('button', { name: /Pošalji ponovno/ })
  await expect(resend).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 800 })
  await switchTheme(page, 'light')
  await expect(page.getByRole('region', { name: /Neuspjeli mailovi \(1\)/ })).toBeVisible()
  await expectNoAxeViolations(page)

  await switchLocale(page, 'en')
  const english = page.getByRole('region', { name: /Failed mail \(1\)/ })
  await expect(english).toBeVisible()
  await english.getByRole('button', { name: /Send again/ }).click()
  await expect(page.getByRole('heading', { name: /Failed mail/ })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Home, 0', exact: true })).toBeVisible()
})

test('a resend that is no longer current keeps the sentence after the row leaves', async ({ page }) => {
  const tenant = await seedTenant('home-stale-mail')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const places = await placesFor(page)
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Ana Slobodna',
      kind: 'own',
      phone: '+38595555181',
      email: `e2e-stale-${tenant.tenantId.slice(0, 8)}@example.test`,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: 'DU181AA',
      kind: 'fixed',
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const rideId = await record(page, 'Gost Klara', new Date(Date.now() + 5 * 60 * 60 * 1000), places, {
    price: 10,
    payment: 'cash',
  })
  expect((await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })).ok()).toBeTruthy()
  await plantFailedWorkOrder(tenant.tenantId, { rideId, driverId })
  await page.getByRole('button', { name: 'Osvježi', exact: true }).click()
  const block = page.getByRole('region', { name: /Neuspjeli mailovi \(1\)/ })
  await expect(block).toBeVisible()
  // Cancel after the list is on screen. The row is still there; the resend finds the Ride cancelled.
  expect((await page.request.post(`/api/rides/${rideId}/cancel`, { data: {} })).ok()).toBeTruthy()
  await block.getByRole('button', { name: /Pošalji ponovno/ }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Mail više nije aktualan.' })).toBeVisible()
  await expect(page.getByRole('heading', { name: /Neuspjeli mailovi/ })).toHaveCount(0)
})

async function placesFor(page: Page) {
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Agencija Mora', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Zračna luka Dubrovnik', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Hotel Excelsior', kind: 'hotel' },
  }))
  return { clientId, startLocationId, endLocationId }
}

async function record(
  page: Page,
  guestName: string,
  pickupAt: Date,
  places: { clientId: string, startLocationId: string, endLocationId: string },
  fare: { price: number, payment: 'cash' | 'card' | 'invoice_to_agency', flightNumber?: string, tabla?: string },
): Promise<string> {
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId: places.clientId,
      pickupAt: pickupAt.toISOString(),
      startLocationId: places.startLocationId,
      endLocationId: places.endLocationId,
      passengerCount: 1,
      guestName,
      flightNumber: fare.flightNumber,
      tabla: fare.tabla,
      price: fare.price,
      payment: fare.payment,
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const body = await recorded.json() as { ride: { id: string } }
  return body.ride.id
}
