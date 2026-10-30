import type { Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * A main-Transfer correction starts with the extra vehicles included
 * (issue #543, ADR-0054 amendment). Left off, the notice links to the
 * group list. Desktop and phone, both themes, both locales.
 */

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function seedGroup(page: Page, name: string) {
  const clientId = (await (await page.request.post('/api/clients', { data: { name: `Agencija ${name}`, kind: 'agency' } })).json() as { id: string }).id
  const startLocationId = (await (await page.request.post('/api/locations', { data: { name: `Polazak ${name}`, kind: 'airport' } })).json() as { id: string }).id
  const endLocationId = (await (await page.request.post('/api/locations', { data: { name: `Dolazak ${name}`, kind: 'hotel' } })).json() as { id: string }).id
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
  // A free driver and vehicle, so the save does not also warn Popunjeno.
  // That toast's countdown fails contrast on a light page and is not this spec.
  const driver = await page.request.post('/api/drivers', {
    data: {
      name: `Marko ${name}`,
      kind: 'own',
      phone: name === 'Zadano' ? '+385911543001' : '+385911543002',
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  })
  expect(driver.ok()).toBeTruthy()
  const vehicle = await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: name === 'Zadano' ? 'ZG543AA' : 'ZG543BB',
      kind: 'fixed',
      seatCount: 4,
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  })
  expect(vehicle.ok()).toBeTruthy()
  return { day, next }
}

async function extraFlight(page: Page, next: string): Promise<string | null> {
  const nextDay = await page.request.get(`/api/transfers?date=${next}`)
  expect(nextDay.ok()).toBeTruthy()
  const extraRide = (await nextDay.json() as { rides: { guestName: string, flightNumber: string | null }[] }).rides.find(ride => ride.guestName === 'Iva Dodatna')
  return extraRide?.flightNumber ?? null
}

test('the default correction copies the flight, and leaving it off links to the group', async ({ page }) => {
  test.setTimeout(120_000)
  await useTheme(page, 'light')
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('group-default')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const seeded = await seedGroup(page, 'Zadano')

  await page.goto(`/transfers?day=${seeded.day}`)
  await hydrated(page)
  await page.getByRole('row', { name: 'Ana Grupno' }).click()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  const form = page.getByRole('region', { name: 'Ispravi ovaj transfer' })
  await form.getByLabel('Broj leta').fill('OU392')
  const apply = form.getByRole('checkbox', { name: 'Primijeni i na dodatna vozila' })
  await expect(apply).toBeChecked()
  await form.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  await expect(page.getByText('Ispravljeno.')).toBeVisible()
  expect(await extraFlight(page, seeded.next)).toBe('OU392')

  await page.getByRole('row', { name: 'Ana Grupno' }).click()
  await page.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
  const again = page.getByRole('region', { name: 'Ispravi ovaj transfer' })
  await again.getByLabel('Broj leta').fill('OU400')
  await again.getByRole('checkbox', { name: 'Primijeni i na dodatna vozila' }).uncheck()
  await again.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  const notice = page.getByRole('status').filter({ hasText: 'Grupa ima još 1 nedovršeno dodatno vozilo. Promjena nije primijenjena na njega.' })
  await expect(notice).toBeVisible()
  expect(await extraFlight(page, seeded.next)).toBe('OU392')

  const link = notice.getByRole('link', { name: 'Otvori grupu' })
  await expect(link).toHaveAttribute('href', /#transfer-group$/)
  await link.focus()
  await page.keyboard.press('Enter')
  const list = page.getByRole('article').getByRole('region', { name: 'Grupa' })
  await expect(list).toBeVisible()
  await expect(list).toContainText('Iva Dodatna')
  await expectNoAxeViolations(page)
})

test.describe('@phone', () => {
  test('a phone in the dark theme follows the English group link from the keyboard', async ({ page }) => {
    test.setTimeout(120_000)
    await useTheme(page, 'dark')
    await page.setViewportSize({ width: 390, height: 844 })
    const tenant = await seedTenant('group-default-phone')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await switchLocale(page, 'en')
    const seeded = await seedGroup(page, 'Phone')

    await page.goto(`/transfers?day=${seeded.day}`)
    await hydrated(page)
    await page.getByRole('listitem').filter({ hasText: 'Ana Grupno' }).click()
    await page.getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Correct transfer', exact: true }).click()
    const form = page.getByRole('region', { name: 'Correct this transfer' })
    await form.getByLabel('Flight number').fill('OU392')
    await expect(form.getByRole('checkbox', { name: 'Also apply to the extra vehicles' })).toBeChecked()
    await form.getByRole('checkbox', { name: 'Also apply to the extra vehicles' }).uncheck()
    await form.getByRole('button', { name: 'Save correction', exact: true }).click()
    const notice = page.getByRole('status').filter({ hasText: 'The group still has 1 unfinished extra vehicle. This change was not applied to it.' })
    await expect(notice).toBeVisible()
    const link = notice.getByRole('link', { name: 'Open the group' })
    await link.focus()
    await page.keyboard.press('Enter')
    const list = page.getByRole('article').getByRole('region', { name: 'Group' })
    await expect(list).toBeVisible()
    await expect(list).toContainText('Iva Dodatna')
    await expectNoAxeViolations(page)
  })
})
