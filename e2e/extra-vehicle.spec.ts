import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock } from '../shared/date'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, openRideMenu, signIn, switchLocale } from './fixtures/ui'

/**
 * Adding an extra vehicle (issue #466, ADR-0054). The form copies the main
 * Transfer, hides the Price, and asks for the group count only the first
 * time. Desktop opens it from the row and from the detail. The phone opens
 * it from the detail, then adds another vehicle from the extra vehicle.
 */

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

async function createdId(request: APIRequestContext, path: string, data: unknown): Promise<string> {
  const response = await request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  return (await response.json() as { id: string }).id
}

async function seedBooking(page: Page, name: string) {
  const clientId = await createdId(page.request, '/api/clients', { name: `Agencija ${name}`, kind: 'agency' })
  const startLocationId = await createdId(page.request, '/api/locations', { name: `Polazak ${name}`, kind: 'airport' })
  const endLocationId = await createdId(page.request, '/api/locations', { name: `Dolazak ${name}`, kind: 'hotel' })
  return { clientId, startLocationId, endLocationId }
}

test('the detail adds an extra vehicle and an extra vehicle offers no duplicate', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('extra-vehicle')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const places = await seedBooking(page, 'Vozilo')
  const day = operationalDay(page)
  const recorded = await recordTransfer(page.request, {
    data: {
      ...places,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      passengerCount: 4,
      guestName: 'Ana Grupno',
      flightNumber: 'OU384',
      price: 40,
      payment: 'invoice_to_agency',
      airportMark: true,
      luggageCount: 2,
      childSeatCount: 1,
      tabla: 'ANA',
      clientReference: 'V-19',
      note: 'Nazovi recepciju',
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const mainId = (await recorded.json() as { transfer: { id: string } }).transfer.id

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)
  await openRideMenu(page, 'Ana Grupno')
  await expect(page.getByRole('menuitem', { name: 'Dodatno vozilo', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('row', { name: 'Ana Grupno' }).click()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Dupliciraj', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Povratni transfer', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Dodatno vozilo', exact: true }).click()

  const form = page.getByRole('region', { name: 'Dodatno vozilo' })
  await expect(form.getByRole('heading', { name: 'Dodatno vozilo' })).toBeVisible()
  await expect(form.getByRole('button', { name: 'Polazište', exact: true })).toContainText('Polazak Vozilo')
  await expect(form.getByRole('button', { name: 'Odredište', exact: true })).toContainText('Dolazak Vozilo')
  await expect(form.getByLabel('Ime gosta')).toHaveValue('Ana Grupno')
  await expect(form.getByLabel('Referenca naručitelja')).toHaveValue('V-19')
  await expect(form.getByLabel('Vrijeme preuzimanja')).toHaveValue(`${day}T12:00`)
  await expect(form.getByLabel('Putnici')).toHaveValue('')
  await expect(form.getByLabel('Naručeno putnika (grupa)')).toHaveValue('4')
  await expect(form.getByLabel('Cijena (EUR)')).toHaveCount(0)
  await expect(form.getByRole('combobox', { name: 'Plaćanje' })).toContainText('Račun agenciji')
  await expect(form.getByLabel('Broj leta')).toHaveValue('OU384')
  await expect(form.getByLabel('Tabla')).toHaveValue('ANA')
  await expect(form.getByRole('checkbox', { name: 'Aerodromsko preuzimanje' })).toBeChecked()
  await expect(form.getByLabel('Prtljaga')).toHaveValue('')
  await expect(form.getByLabel('Dječje sjedalice')).toHaveValue('')
  await expect(form.getByLabel('Napomena')).toHaveValue('')

  await form.getByLabel('Ime gosta').fill('Ana Vozilo')
  await form.getByLabel('Putnici').fill('2')
  await form.getByLabel('Naručeno putnika (grupa)').fill('9')
  await form.getByLabel('Prtljaga').fill('0')
  await form.getByLabel('Dječje sjedalice').fill('0')
  await form.getByRole('button', { name: 'Zabilježi transfer', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Notifications (F8)' }).getByText('Zabilježeno.')).toBeVisible()

  const rides = await dayRides(page, day)
  const main = rides.find(ride => ride.transferId === mainId)
  const extra = rides.find(ride => ride.transferId !== mainId)
  expect(main).toMatchObject({
    passengerCount: 4,
    groupPassengerCount: 9,
    price: '40.00',
    note: 'Nazovi recepciju',
  })
  expect(extra).toMatchObject({
    mainTransferId: mainId,
    guestName: 'Ana Vozilo',
    passengerCount: 2,
    groupPassengerCount: null,
    price: '0.00',
    flightNumber: 'OU384',
    tabla: 'ANA',
    clientReference: 'V-19',
    luggageCount: 0,
    childSeatCount: 0,
    note: null,
    airportMark: true,
  })

  await page.getByRole('row', { name: 'Ana Vozilo' }).click()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Dodatno vozilo', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Dupliciraj', exact: true })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Povratni transfer', exact: true })).toHaveCount(0)
})

test.describe('@phone', () => {
  test('a phone adds an extra vehicle from the detail and another from that vehicle', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 390, height: 844 })
    const tenant = await seedTenant('extra-vehicle-phone')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await switchLocale(page, 'en')
    const places = await seedBooking(page, 'Phone')
    const day = operationalDay(page)
    const recorded = await recordTransfer(page.request, {
      data: {
        ...places,
        pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
        passengerCount: 3,
        guestName: 'Iva Phone',
        flightNumber: 'OU100',
        price: 25,
        payment: 'cash',
        airportMark: false,
        luggageCount: 1,
        childSeatCount: 0,
        tabla: 'IVA',
        clientReference: 'P-1',
        note: 'Call the desk',
      },
    })
    expect(recorded.ok()).toBeTruthy()
    const mainId = (await recorded.json() as { transfer: { id: string } }).transfer.id

    await page.goto(`/transfers?day=${day}`)
    await hydrated(page)
    // The new-transfer button covers the row menu, and the dated clock
    // squeezes the guest name to nothing. The time opens the detail.
    await openPhoneCard(page, 'Iva Phone')
    const detail = page.getByRole('dialog')
    await detail.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Extra vehicle', exact: true }).click()

    const form = page.getByRole('region', { name: 'Extra vehicle' })
    await expect(form.getByRole('heading', { name: 'Extra vehicle' })).toBeVisible()
    await expect(form.getByLabel('Guest name')).toHaveValue('Iva Phone')
    await expect(form.getByLabel('Passengers', { exact: true })).toHaveValue('')
    await expect(form.getByLabel('Passengers ordered (group)')).toHaveValue('3')
    await expect(form.getByLabel('Price (EUR)')).toHaveCount(0)
    await expect(form.getByLabel('Client reference')).toHaveValue('P-1')
    await expect(form.getByLabel('Flight number')).toHaveValue('OU100')
    await expect(form.getByLabel('Note')).toHaveValue('')
    await form.getByLabel('Guest name').fill('Iva First')
    await form.getByLabel('Passengers', { exact: true }).fill('1')
    await form.getByLabel('Luggage').fill('0')
    await form.getByLabel('Child seats').fill('0')
    await form.getByRole('button', { name: 'Record transfer', exact: true }).click()
    // Recording opens the new Ride. On a phone that detail is a modal, so
    // the toast sits behind it.
    const extraDetail = page.getByRole('dialog', { name: 'Iva First' })
    await expect(extraDetail).toBeVisible()
    await extraDetail.getByRole('button', { name: 'More', exact: true }).click()
    await expect(page.getByRole('menuitem', { name: 'Extra vehicle', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Return journey', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Extra vehicle', exact: true }).click()

    const again = page.getByRole('region', { name: 'Extra vehicle' })
    await expect(again.getByLabel('Passengers ordered (group)')).toHaveCount(0)
    await expect(again.getByLabel('Price (EUR)')).toHaveCount(0)
    await expect(again.getByLabel('Guest name')).toHaveValue('Iva Phone')
    await again.getByLabel('Guest name').fill('Iva Second')
    await again.getByLabel('Passengers', { exact: true }).fill('1')
    await again.getByLabel('Luggage').fill('0')
    await again.getByLabel('Child seats').fill('0')
    await again.getByRole('button', { name: 'Record transfer', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Iva Second' })).toBeVisible()

    const rides = await dayRides(page, day)
    const main = rides.find(ride => ride.transferId === mainId)
    const extras = rides.filter(ride => ride.transferId !== mainId)
    expect(main).toMatchObject({ groupPassengerCount: 3, passengerCount: 3, price: '25.00' })
    expect(extras).toHaveLength(2)
    expect(extras.every(ride => ride.mainTransferId === mainId && ride.price === '0.00' && ride.groupPassengerCount === null)).toBe(true)
    expect(extras.map(ride => ride.guestName).sort()).toEqual(['Iva First', 'Iva Second'])
  })
})

interface DayRide {
  transferId: string
  mainTransferId: string | null
  guestName: string
  passengerCount: number
  groupPassengerCount: number | null
  price: string
  flightNumber: string | null
  tabla: string
  clientReference: string | null
  luggageCount: number
  childSeatCount: number
  note: string | null
  airportMark: boolean
}

/** The phone card sits under the day filters. Its guest name can shrink to zero width. */
async function openPhoneCard(page: Page, guest: string) {
  const time = page.getByRole('listitem').filter({ hasText: guest }).getByRole('time')
  await time.evaluate(element => element.scrollIntoView({ block: 'center' }))
  await time.click()
}

async function dayRides(page: Page, day: string): Promise<DayRide[]> {
  const listed = await page.request.get(`/api/transfers?date=${day}`)
  expect(listed.ok()).toBeTruthy()
  return (await listed.json() as { rides: DayRide[] }).rides
}
