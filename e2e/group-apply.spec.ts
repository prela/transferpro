import { addCalendarDays, instantFromWallClock } from '../shared'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn } from './fixtures/ui'

/**
 * Applying a main-Transfer correction to its extra vehicles (issue #468, ADR-0054).
 * The offer appears when the pickup, a start or end Location, or the flight changes.
 * Ticked, the extra vehicle receives those fields and not the guest.
 * Left off stays covered by the group-list spec.
 */

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

test('a ticked route correction copies the flight onto the extra vehicle and leaves its guest', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('group-apply')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const clientId = (await (await page.request.post('/api/clients', { data: { name: 'Agencija Primjena', kind: 'agency' } })).json() as { id: string }).id
  const startLocationId = (await (await page.request.post('/api/locations', { data: { name: 'Polazak Primjena', kind: 'airport' } })).json() as { id: string }).id
  const endLocationId = (await (await page.request.post('/api/locations', { data: { name: 'Dolazak Primjena', kind: 'hotel' } })).json() as { id: string }).id
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
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(main.ok()).toBeTruthy()
  const mainId = (await main.json() as { transfer: { id: string } }).transfer.id
  const extra = await recordTransfer(page.request, {
    data: {
      clientId,
      startLocationId,
      endLocationId,
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

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await page.getByRole('row', { name: 'Ana Grupno' }).click()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  const form = page.getByRole('region', { name: 'Ispravi ovaj transfer' })
  await form.getByLabel('Ime gosta').fill('Ana Nova')
  await expect(form.getByRole('checkbox', { name: 'Primijeni i na dodatna vozila' })).toHaveCount(0)
  await form.getByLabel('Broj leta').fill('OU392')
  const apply = form.getByRole('checkbox', { name: 'Primijeni i na dodatna vozila' })
  await expect(apply).not.toBeChecked()
  await apply.check()
  await form.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  await expect(page.getByText('Ispravljeno.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Notifications (F8)' })).not.toContainText('nije primijenjena')

  const nextDay = await page.request.get(`/api/transfers?date=${next}`)
  expect(nextDay.ok()).toBeTruthy()
  const extraRide = (await nextDay.json() as { rides: { guestName: string, flightNumber: string | null }[] }).rides.find(ride => ride.guestName === 'Iva Dodatna')
  expect(extraRide).toMatchObject({ flightNumber: 'OU392' })
})
