import type { Page } from '@playwright/test'
import { addCalendarDays, formatInstant, instantFromWallClock } from '../shared'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale } from './fixtures/ui'

/**
 * The group on the day list and the Ride detail (issue #470, ADR-0054).
 * The badge marks a group. The detail lists each member's own pickup.
 * A route correction that is not applied to the group says how many
 * unfinished extra vehicles it left. Desktop and phone.
 */

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

async function seedGroup(page: Page, name: string) {
  const clientId = (await (await page.request.post('/api/clients', { data: { name: `Agencija ${name}`, kind: 'agency' } })).json() as { id: string }).id
  const startLocationId = (await (await page.request.post('/api/locations', { data: { name: `Polazak ${name}`, kind: 'airport' } })).json() as { id: string }).id
  const endLocationId = (await (await page.request.post('/api/locations', { data: { name: `Dolazak ${name}`, kind: 'hotel' } })).json() as { id: string }).id
  const otherEndLocationId = (await (await page.request.post('/api/locations', { data: { name: `Drugi ${name}`, kind: 'address' } })).json() as { id: string }).id
  const day = operationalDay(page)
  const next = addCalendarDays(day, 1)
  const mainPickup = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
  const extraPickup = instantFromWallClock(`${next}T09:30`, 'Europe/Zagreb').toISOString()
  const main = await recordTransfer(page.request, {
    data: {
      clientId,
      startLocationId,
      endLocationId,
      pickupAt: mainPickup,
      passengerCount: 4,
      guestName: 'Ana Grupno',
      flightNumber: 'OU384',
      price: 40,
      payment: 'invoice_to_agency',
      airportMark: true,
      luggageCount: 1,
      childSeatCount: 0,
      tabla: 'ANA',
      clientReference: 'G-1',
    },
  })
  expect(main.ok()).toBeTruthy()
  const mainId = (await main.json() as { transfer: { id: string } }).transfer.id
  const extra = await recordTransfer(page.request, {
    data: {
      clientId,
      startLocationId,
      endLocationId: otherEndLocationId,
      pickupAt: extraPickup,
      passengerCount: 2,
      guestName: 'Iva Dodatna',
      flightNumber: 'OU384',
      price: 0,
      payment: 'invoice_to_agency',
      airportMark: true,
      luggageCount: 0,
      childSeatCount: 0,
      mainTransferId: mainId,
      groupPassengerCount: 9,
      mainVersion: 0,
    },
  })
  expect(extra.ok()).toBeTruthy()
  const plain = await recordTransfer(page.request, {
    data: {
      clientId,
      startLocationId,
      endLocationId,
      pickupAt: instantFromWallClock(`${day}T14:00`, 'Europe/Zagreb').toISOString(),
      passengerCount: 1,
      guestName: 'Iva Sama',
      price: 15,
      payment: 'card',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(plain.ok()).toBeTruthy()
  return { day, next, mainPickup, extraPickup, mainId }
}

test('the day list marks the group, the detail lists each pickup, and a route change says what it left', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('group-list')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const seeded = await seedGroup(page, 'Grupa')
  const mainLabel = formatInstant(new Date(seeded.mainPickup), 'Europe/Zagreb', 'hr')
  const extraLabel = formatInstant(new Date(seeded.extraPickup), 'Europe/Zagreb', 'hr')

  await page.goto(`/transfers?day=${seeded.day}`)
  await hydrated(page)
  const mainRow = page.getByRole('row', { name: 'Ana Grupno' })
  await expect(mainRow.getByText('Grupa', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: 'Iva Sama' }).getByText('Grupa', { exact: true })).toHaveCount(0)

  await mainRow.click()
  const list = page.getByRole('article').getByRole('region', { name: 'Grupa' })
  await expect(list).toContainText('Naručeno putnika (grupa): 9')
  const extraItem = list.getByRole('listitem').filter({ hasText: 'Iva Dodatna' })
  await expect(extraItem).toContainText(extraLabel)
  await expect(extraItem).toContainText('Drugi Grupa')
  await expect(extraItem).not.toContainText(mainLabel)
  await expect(list.getByRole('listitem').filter({ hasText: 'Ana Grupno' })).toContainText(mainLabel)

  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  const form = page.getByRole('region', { name: 'Ispravi ovaj transfer' })
  await expect(form.getByLabel('Naručeno putnika (grupa)')).toHaveValue('9')
  await form.getByLabel('Naručeno putnika (grupa)').fill('11')
  await form.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  await expect(page.getByText('Ispravljeno.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Notifications (F8)' })).not.toContainText('nije primijenjena')

  await page.getByRole('row', { name: 'Ana Grupno' }).click()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  const again = page.getByRole('region', { name: 'Ispravi ovaj transfer' })
  await expect(again.getByLabel('Naručeno putnika (grupa)')).toHaveValue('11')
  await again.getByLabel('Broj leta').fill('OU392')
  await again.getByRole('checkbox', { name: 'Primijeni i na dodatna vozila' }).uncheck()
  await again.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Notifications (F8)' })).toContainText('Grupa ima još 1 nedovršeno dodatno vozilo. Promjena nije primijenjena na njega.')

  const nextDay = await page.request.get(`/api/transfers?date=${seeded.next}`)
  expect(nextDay.ok()).toBeTruthy()
  const extraRide = (await nextDay.json() as { rides: { guestName: string, flightNumber: string | null, pickupAt: string }[] }).rides.find(ride => ride.guestName === 'Iva Dodatna')
  expect(extraRide).toMatchObject({ flightNumber: 'OU384', pickupAt: seeded.extraPickup })
})

test.describe('@phone', () => {
  test('a phone shows the group badge, each member pickup, and the route notice', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const tenant = await seedTenant('group-list-phone')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await switchLocale(page, 'en')
    const seeded = await seedGroup(page, 'Phone')
    const mainLabel = formatInstant(new Date(seeded.mainPickup), 'Europe/Zagreb', 'en')
    const extraLabel = formatInstant(new Date(seeded.extraPickup), 'Europe/Zagreb', 'en')

    await page.goto(`/transfers?day=${seeded.day}`)
    await hydrated(page)
    const row = page.getByRole('listitem').filter({ hasText: 'Ana Grupno' })
    await expect(row.getByText('Group', { exact: true })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'Iva Sama' }).getByText('Group', { exact: true })).toHaveCount(0)

    await row.click()
    const list = page.getByRole('article').getByRole('region', { name: 'Group' })
    await expect(list).toContainText('Passengers ordered (group): 9')
    const extraItem = list.getByRole('listitem').filter({ hasText: 'Iva Dodatna' })
    await expect(extraItem).toContainText(extraLabel)
    await expect(extraItem).toContainText('Drugi Phone')
    await expect(extraItem).not.toContainText(mainLabel)

    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Correct transfer', exact: true }).click()
    const form = page.getByRole('region', { name: 'Correct this transfer' })
    await form.getByLabel('Flight number').fill('OU392')
    await form.getByRole('checkbox', { name: 'Also apply to the extra vehicles' }).uncheck()
    await form.getByRole('button', { name: 'Save correction', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Notifications (F8)' })).toContainText('The group still has 1 unfinished extra vehicle. This change was not applied to it.')
  })
})
