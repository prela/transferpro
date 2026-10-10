import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, switchLocale, switchTheme } from './fixtures/ui'

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
  await expect(page.getByRole('heading', { level: 1, name: 'Prijava' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toHaveCount(0)
  await expect(page.getByLabel('E-pošta')).toBeVisible()
})

test('office home loads both reads, stays still, and a keyboard refresh loads both again', async ({ page }) => {
  const tenant = await seedTenant('home-refresh')
  const reads = watchReads(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toBeVisible()
  const unassigned = page.getByRole('region', { name: 'Nedodijeljeno' })
  const waiting = page.getByRole('region', { name: 'Čeka na prihvat' })
  const progress = page.getByRole('region', { name: 'U tijeku' })
  await expect(unassigned).toContainText('Ovaj popis je prazan.')
  await expect(waiting).toContainText('Ovaj popis je prazan.')
  await expect(progress).toContainText('Ovaj popis je prazan.')
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hrvatski' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Svijetla tema' })).toHaveCount(0)
  await expect.poll(() => reads.office).toBeGreaterThan(0)
  await expect.poll(() => reads.documents).toBeGreaterThan(0)

  const officeAfterOpen = reads.office
  const documentsAfterOpen = reads.documents
  // Long enough that a short poll would have fired. Home has no timer.
  await page.waitForTimeout(1500)
  expect(reads.office).toBe(officeAfterOpen)
  expect(reads.documents).toBe(documentsAfterOpen)

  const refresh = page.getByRole('button', { name: 'Osvježi početnu', exact: true })
  await refresh.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => reads.office).toBeGreaterThan(officeAfterOpen)
  await expect.poll(() => reads.documents).toBeGreaterThan(documentsAfterOpen)
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
    data: { driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()

  await page.getByRole('button', { name: 'Osvježi početnu', exact: true }).click()

  const unassigned = page.getByRole('region', { name: 'Nedodijeljeno' })
  const alarm = unassigned.getByRole('listitem').filter({ hasText: 'Alarm Ana' })
  await expect(alarm).toContainText('Alarm za nedodijeljenu vožnju')
  await expect(alarm).toContainText('42,50 EUR')
  await expect(alarm).toContainText('Gotovina')
  await expect(alarm).toContainText('OU 384')
  await expect(alarm).toContainText('Zračna luka Dubrovnik')
  await expect(alarm).toContainText('Hotel Excelsior')
  await expect(alarm.getByRole('link')).toHaveCount(0)
  await expect(unassigned.getByRole('listitem').filter({ hasText: 'Card Ivo' })).toContainText('18,00 EUR')
  await expect(unassigned.getByRole('listitem').filter({ hasText: 'Card Ivo' })).toContainText('Kartica')
  await expect(unassigned.getByRole('listitem').filter({ hasText: 'Agency Eva' })).toContainText('0,00 EUR')
  await expect(unassigned.getByRole('listitem').filter({ hasText: 'Agency Eva' })).toContainText('Račun agenciji')
  await expect(unassigned).toContainText('Old Luka')

  const waitingList = page.getByRole('region', { name: 'Čeka na prihvat' })
  const waitingRow = waitingList.getByRole('listitem').filter({ hasText: 'Waiting Nika' })
  await expect(waitingRow).toContainText('Marko Vozač')
  await expect(waitingRow).toContainText('DU146AA')
  await expect(waitingRow).not.toContainText('Alarm za nedodijeljenu vožnju')
  await expect(page.getByRole('region', { name: 'U tijeku' })).toContainText('Ovaj popis je prazan.')

  const counts = page.getByRole('region', { name: 'Brojevi za operativni dan' })
  await expect(counts).toContainText('Vožnje')
  await expect(counts).toContainText('Obavljeno')
  await expect(counts).toContainText('Nedolazak')
  await expect(counts).toContainText('Otkazano')
  await expect(counts).not.toContainText('EUR')

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { name: 'Counts for the operational day' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Unassigned' }).getByRole('listitem').filter({ hasText: 'Alarm Ana' })).toContainText('Unassigned alarm')
  await expect(page.getByRole('region', { name: 'Unassigned' }).getByRole('listitem').filter({ hasText: 'Alarm Ana' })).toContainText('42.50 EUR')
  await expect(page.getByRole('button', { name: 'English' })).toHaveCount(0)

  await switchTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.getByRole('region', { name: 'Unassigned' }).getByRole('listitem').filter({ hasText: 'Alarm Ana' })).toContainText('Unassigned alarm')
  await switchTheme(page, 'light')
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await expect(page.getByRole('region', { name: 'Unassigned' }).getByRole('listitem').filter({ hasText: 'Alarm Ana' })).toBeVisible()
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
  await expect(page.getByRole('region', { name: 'Nedodijeljeno' })).toContainText('Ovaj popis je prazan.')
  await expect(page.getByText('Dokumente nije bilo moguće učitati. Pokušajte ponovno.')).toBeVisible()
})

test('a driver does not see the lists or counts and the office read is not requested', async ({ page }) => {
  const tenant = await seedTenant('home-driver')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  const reads = watchReads(page)
  await signIn(page, driver.email, driver.password, tenant.name)

  await expect(page.getByRole('heading', { name: 'Moje vožnje' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dokumenti koji istječu' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brojevi za operativni dan' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Osvježi početnu' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Osvježi dokumente' })).toBeVisible()
  expect(reads.office).toBe(0)
  await expect.poll(() => reads.documents).toBeGreaterThan(0)
})

async function record(
  page: Page,
  guestName: string,
  pickupAt: Date,
  places: { clientId: string, startLocationId: string, endLocationId: string },
  fare: { price: number, payment: 'cash' | 'card' | 'invoice_to_agency', flightNumber?: string },
): Promise<string> {
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId: places.clientId,
      pickupAt: pickupAt.toISOString(),
      startLocationId: places.startLocationId,
      endLocationId: places.endLocationId,
      passengerCount: 1,
      guestName,
      flightNumber: fare.flightNumber,
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
