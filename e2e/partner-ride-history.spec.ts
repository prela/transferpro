import type { Page } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * The Vožnje tab on the Partner record, including an archived Partner, and
 * the Partner phone and email on a handed-off Ride (ADR-0049, issue #416).
 * Counts cover the whole history, including the Ride that is still on the
 * next page. The phone project runs this block. The desktop project runs it
 * beside the table. A new Tenant starts at Europe/Zagreb and operational day 05:00.
 */

const zone = 'Europe/Zagreb'
const pageSize = 50
const partnerPhone = '+385914160001'
const partnerEmail = 'mora.povijest@example.test'

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

function card(page: Page, phone: boolean, name: string) {
  return page.getByRole(phone ? 'dialog' : 'region', { name })
}

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function book(
  page: Page,
  booking: { clientId: string, startLocationId: string, endLocationId: string },
  guestName: string,
  wall: string,
  price: number,
  payment: 'cash' | 'card' | 'invoice_to_agency',
): Promise<string> {
  const recorded = await recordTransfer(page.request, {
    data: {
      ...booking,
      guestName,
      pickupAt: instantFromWallClock(wall, zone).toISOString(),
      passengerCount: 1,
      price,
      payment,
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const body = await recorded.json() as { ride: { id: string } }
  return body.ride.id
}

/** A handful at a time. Fifty-one creates at once crowd the local server. */
async function bookAll(
  page: Page,
  booking: { clientId: string, startLocationId: string, endLocationId: string },
  rows: { guestName: string, wall: string, price: number, payment: 'cash' | 'card' | 'invoice_to_agency' }[],
): Promise<string[]> {
  const ids = Array.from({ length: rows.length }).fill('') as string[]
  let cursor = 0
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor
      cursor += 1
      const row = rows[index]
      if (row === undefined)
        return
      ids[index] = await book(page, booking, row.guestName, row.wall, row.price, row.payment)
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))
  return ids
}

async function handOff(page: Page, rideId: string, partnerId: string) {
  const response = await page.request.post(`/api/rides/${rideId}/hand-off`, {
    data: { partnerId, version: 0 },
  })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
}

async function handOffAll(page: Page, rideIds: string[], partnerId: string) {
  let cursor = 0
  async function worker() {
    while (cursor < rideIds.length) {
      const index = cursor
      cursor += 1
      const rideId = rideIds[index]
      if (rideId === undefined)
        return
      await handOff(page, rideId, partnerId)
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))
}

async function postEmpty(page: Page, path: string) {
  const response = await page.request.post(path, { data: {} })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
}

test.describe('@phone', () => {
  test('the office opens an archived Partner history, loads the rest, and sees the phone', async ({ page }) => {
    test.setTimeout(240_000)
    const phone = isPhone(page)
    if (!phone)
      await page.setViewportSize({ width: 1440, height: 900 })
    const tenant = await seedTenant('partner-rides-hr')
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

    const partnerName = 'Mora Povijest'
    const partnerId = await createdId(page, '/api/partners', {
      name: partnerName,
      phone: partnerPhone,
      email: partnerEmail,
      note: 'Stoji na Čilipima',
    })
    const clientId = await createdId(page, '/api/clients', { name: 'Agencija Povijest', kind: 'agency' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Povijest', kind: 'address' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Povijest', kind: 'hotel' })
    const booking = { clientId, startLocationId, endLocationId }
    const newestWall = '2026-10-20T12:00'
    const rows: { guestName: string, wall: string, price: number, payment: 'cash' | 'card' | 'invoice_to_agency' }[] = [
      { guestName: 'Ana Najnovija', wall: newestWall, price: 42.5, payment: 'cash' },
    ]
    for (let index = 1; index <= 47; index += 1)
      rows.push({ guestName: `Gost ${String(index).padStart(2, '0')}`, wall: wallBefore(index), price: 10, payment: 'cash' })
    rows.push(
      { guestName: 'Završeni Gost', wall: '2026-10-18T12:00', price: 15, payment: 'card' },
      { guestName: 'Gost Nedolazak', wall: '2026-10-17T12:00', price: 8, payment: 'cash' },
      { guestName: 'Stari Gost', wall: '2026-10-01T09:00', price: 0, payment: 'invoice_to_agency' },
    )
    const ids = await bookAll(page, booking, rows)
    const newestId = ids[0]
    const doneId = ids[48]
    const noShowId = ids[49]
    const cancelledId = ids[50]
    if (newestId === undefined || doneId === undefined || noShowId === undefined || cancelledId === undefined || ids.includes(''))
      throw new Error('Partner Ride history seed is short.')

    await handOffAll(page, ids, partnerId)
    await postEmpty(page, `/api/rides/${doneId}/done`)
    await postEmpty(page, `/api/rides/${noShowId}/no-show`)
    await postEmpty(page, `/api/rides/${cancelledId}/cancel`)
    await postEmpty(page, `/api/partners/${partnerId}/archive`)

    await page.goto('/partners')
    await hydrated(page)
    await expect(page.locator('html')).toHaveClass(/light/)
    await page.getByLabel('Prikaži arhivirano').check()
    await page.getByRole('button', { name: partnerName, exact: true }).click()
    const panel = card(page, phone, partnerName)
    await panel.getByRole('tab', { name: 'Vožnje' }).click()

    const history = panel.locator('#partner-ride-history')
    await expect(history.getByText('Ukupno 51 · Obavljeno 1 · Nedolazak 1 · Otkazano 1')).toBeVisible()
    await expect(history.getByRole('link')).toHaveCount(pageSize)
    await expect(history.getByRole('link', { name: /Stari Gost/ })).toHaveCount(0)

    const newest = history.getByRole('link', { name: /Ana Najnovija/ })
    const newestAt = instantFromWallClock(newestWall, zone)
    await expect(newest).toContainText(formatInstant(newestAt, zone, 'hr'))
    await expect(newest).toContainText('Polazak Povijest')
    await expect(newest).toContainText('Dolazak Povijest')
    await expect(newest).toContainText('Predano podizvođaču')
    await expect(newest).toContainText(partnerName)
    await expect(newest).toContainText('42,50 EUR')
    await expect(newest).toContainText('Gotovina')
    await expect(history.getByRole('link', { name: /Završeni Gost/ })).toContainText('Obavljeno')
    await expect(history.getByRole('link', { name: /Završeni Gost/ })).toContainText(partnerName)
    await expect(history.getByRole('link', { name: /Završeni Gost/ })).toContainText('15,00 EUR')
    await expect(history.getByRole('link', { name: /Završeni Gost/ })).toContainText('Kartica')
    await expect(history.getByRole('link', { name: /Gost Nedolazak/ })).toContainText('Nedolazak')
    await expectNoAxeViolations(page)

    const more = page.waitForResponse(response =>
      response.request().method() === 'GET' && response.url().includes('/ride-history') && response.url().includes('cursor=') && response.ok())
    await history.getByRole('button', { name: 'Učitaj još', exact: true }).click()
    await more
    await expect(history.getByRole('link')).toHaveCount(pageSize + 1)
    await expect(history.getByRole('button', { name: 'Učitaj još', exact: true })).toHaveCount(0)
    const oldest = history.getByRole('link', { name: /Stari Gost/ })
    await expect(oldest).toContainText('Otkazano')
    await expect(oldest).toContainText(partnerName)
    await expect(oldest).toContainText('0,00 EUR')
    await expect(oldest).toContainText('Račun agenciji')

    const day = operationalDateInTimeZone(zone, newestAt)
    await newest.click()
    await expect(page).toHaveURL(new RegExp(`day=${day}`))
    await expect(page).toHaveURL(new RegExp(`ride=${newestId}`))
    const detail = page.locator('#ride-detail')
    await expect(detail.getByRole('heading', { level: 2, name: 'Ana Najnovija' })).toBeVisible()
    const contact = detail.locator('#ride-partner-contact')
    await expect(contact).toContainText(partnerName)
    await expect(contact).toContainText('Arhivirano')
    await expect(contact.locator(`a[href="tel:${partnerPhone}"]`)).toBeVisible()
    await expect(contact.locator(`a[href="mailto:${partnerEmail}"]`)).toBeVisible()
    await expectNoAxeViolations(page)
  })

  test('an English Partner Ride history in the dark theme', async ({ page }) => {
    const phone = isPhone(page)
    if (!phone)
      await page.setViewportSize({ width: 1440, height: 900 })
    const tenant = await seedTenant('partner-rides-en')
    await useTheme(page, 'dark')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await switchLocale(page, 'en')

    const partnerName = 'Hotel Sunce Partner'
    const partnerId = await createdId(page, '/api/partners', {
      name: partnerName,
      phone: partnerPhone,
      email: partnerEmail,
    })
    const clientId = await createdId(page, '/api/clients', { name: 'Hotel Sunce', kind: 'hotel' })
    const startLocationId = await createdId(page, '/api/locations', { name: 'Start Sunce', kind: 'address' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'End Sunce', kind: 'hotel' })
    const wall = '2026-10-20T15:30'
    const rideId = await book(page, { clientId, startLocationId, endLocationId }, 'Iva English', wall, 10, 'cash')
    await handOff(page, rideId, partnerId)

    await page.goto('/partners')
    await hydrated(page)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('button', { name: partnerName, exact: true }).click()
    const panel = card(page, phone, partnerName)
    await panel.getByRole('tab', { name: 'Rides' }).click()
    const history = panel.locator('#partner-ride-history')
    await expect(history.getByText('Total 1 · Done 0 · No-show 0 · Cancelled 0')).toBeVisible()
    await expect(history.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0)
    const row = history.getByRole('link', { name: /Iva English/ })
    await expect(row).toContainText(formatInstant(instantFromWallClock(wall, zone), zone, 'en'))
    await expect(row).toContainText('Start Sunce')
    await expect(row).toContainText('End Sunce')
    await expect(row).toContainText('Handed off')
    await expect(row).toContainText(partnerName)
    await expect(row).toContainText('10.00 EUR')
    await expect(row).toContainText('Cash')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoAxeViolations(page)

    const day = operationalDateInTimeZone(zone, instantFromWallClock(wall, zone))
    await row.click()
    await expect(page).toHaveURL(new RegExp(`day=${day}`))
    await expect(page).toHaveURL(new RegExp(`ride=${rideId}`))
    const detail = page.locator('#ride-detail')
    await expect(detail.getByRole('heading', { level: 2, name: 'Iva English' })).toBeVisible()
    const contact = detail.locator('#ride-partner-contact')
    await expect(contact.locator(`a[href="tel:${partnerPhone}"]`)).toBeVisible()
    await expect(contact.locator(`a[href="mailto:${partnerEmail}"]`)).toBeVisible()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoAxeViolations(page)
  })
})

/**
 * `index` minutes before 20 October 2026 at 12:00. Forty-seven minutes
 * still lands at 11:13 that day, so these Rides sort just behind the newest.
 */
function wallBefore(index: number): string {
  const total = 12 * 60 - index
  const hour = String(Math.floor(total / 60)).padStart(2, '0')
  const minute = String(total % 60).padStart(2, '0')
  return `2026-10-20T${hour}:${minute}`
}
