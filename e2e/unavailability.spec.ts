import type { APIResponse, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock, mondayOfWeek, operationalDateInTimeZone } from '../shared/date'
import { formatCalendarDate, formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { chooseOption, openAudit, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Unavailability windows (Nedostupnost, ADR-0034, issue #355) in the Driver
 * and Vehicle edit panels, the board warning, the roster marks, and the
 * confirmation that names an unavailability rather than an overlap.
 */
const zone = 'Europe/Zagreb'
const licence = addCalendarDays(calendarDateInTimeZone(zone, new Date()), 400)
const rideDay = operationalDateInTimeZone(zone, new Date())

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function driver(page: Page, name: string, phone: string): Promise<string> {
  return createdId(await page.request.post('/api/drivers', {
    data: { name, kind: 'own', phone, drivingLicenceExpiresOn: licence, transportLicenceExpiresOn: licence },
  }))
}

async function vehicle(page: Page, registrationPlate: string): Promise<string> {
  return createdId(await page.request.post('/api/vehicles', {
    data: { registrationPlate, kind: 'fixed', registrationExpiresOn: licence, technicalInspectionExpiresOn: licence, insuranceExpiresOn: licence },
  }))
}

async function recordRide(page: Page, guest: string, wall: string): Promise<string> {
  const clientId = await createdId(await page.request.post('/api/clients', { data: { name: `Klijent ${guest}`, kind: 'agency' } }))
  const startLocationId = await createdId(await page.request.post('/api/locations', { data: { name: `Polazak ${guest}`, kind: 'airport' } }))
  const endLocationId = await createdId(await page.request.post('/api/locations', { data: { name: `Dolazak ${guest}`, kind: 'hotel' } }))
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${rideDay}T${wall}`, zone).toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      price: 10,
      payment: 'cash',
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

async function putRoster(page: Page, driverId: string, vehicleId: string): Promise<void> {
  const response = await page.request.put('/api/roster', { data: { rosterDate: rideDay, driverId, vehicleId } })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
}

/** The roster shows the week of today. Step to the week of the operational day when they differ. */
async function showRosterWeek(page: Page, previousWeek: string) {
  if (mondayOfWeek(rideDay) !== mondayOfWeek(calendarDateInTimeZone(zone, new Date())))
    await page.getByRole('button', { name: previousWeek }).click()
}

test('the office marks a Driver away for whole days, sees it on the board and the roster, confirms an assignment, and removes it', async ({ page }) => {
  const tenant = await seedTenant('unavailability-hr')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const awayId = await driver(page, 'Ana Odsutna', '+385911110355')
  const carId = await vehicle(page, 'DU355AA')
  await vehicle(page, 'DU355BB')
  const coveredRide = await recordRide(page, 'Iva Pokrivena', '12:00')
  expect((await page.request.post(`/api/rides/${coveredRide}/assign`, { data: { version: 0, driverId: awayId, vehicleId: carId } })).ok()).toBeTruthy()
  await recordRide(page, 'Nika Kasnija', '17:00')
  await putRoster(page, awayId, carId)

  await page.getByRole('link', { name: 'Vozači' }).click()
  await page.getByRole('button', { name: 'Ana Odsutna', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const section = dialog.getByRole('region', { name: 'Nedostupnost' })
  await expect(section).toContainText('Nema zabilježene nedostupnosti.')
  await expect(section.getByRole('checkbox', { name: 'Cijeli dani' })).toBeChecked()

  // The last day before the first is refused in the browser and nothing is sent.
  await section.getByLabel('Prvi dan', { exact: true }).fill(rideDay)
  await section.getByLabel('Zadnji dan', { exact: true }).fill(addCalendarDays(rideDay, -1))
  await section.getByRole('button', { name: 'Dodaj nedostupnost', exact: true }).click()
  await expect(section.getByRole('alert')).toContainText('zadnji ne smije biti prije prvog')

  await section.getByLabel('Zadnji dan', { exact: true }).fill(rideDay)
  await section.getByRole('button', { name: 'Dodaj nedostupnost', exact: true }).click()
  const covered = section.getByRole('status').filter({ hasText: 'Ova nedostupnost pokriva vožnje' })
  await expect(covered).toContainText(formatInstant(instantFromWallClock(`${rideDay}T12:00`, zone), zone, 'hr'))
  const dayLabel = formatCalendarDate(rideDay, 'hr')
  await expect(section.getByRole('list', { name: 'Zabilježena nedostupnost' })).toContainText(dayLabel)
  await expectNoAxeViolations(page)
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('link', { name: 'Transferi' }).click()
  await expect(page.getByRole('row').filter({ hasText: 'Iva Pokrivena' })).toContainText('Nedostupan')

  await page.getByRole('row', { name: 'Nika Kasnija' }).getByRole('button', { name: 'Dodijeli: Nika Kasnija' }).click()
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), 'Ana Odsutna')
  await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), 'DU355BB')
  await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Ovaj vozač ili vozilo je tada nedostupan' })
  await expect(confirm).toContainText('ova potvrda vrijedi za oboje')
  await expectNoAxeViolations(page)
  await confirm.getByRole('button', { name: 'Nastavi svejedno', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByRole('row', { name: 'Nika Kasnija' }).getByRole('button', { name: 'Dodijeli: Nika Kasnija' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Raspored' }).click()
  await expect(page).toHaveURL(/\/roster$/)
  await expect(page.getByText('Učitavanje rasporeda')).toHaveCount(0)
  await showRosterWeek(page, 'Prethodni tjedan')
  await expect(page.getByRole('row').filter({ hasText: 'Ana Odsutna' })).toContainText('Vozač nedostupan')

  await page.getByRole('link', { name: 'Vozači' }).click()
  await expect(page).toHaveURL(/\/drivers$/)
  await page.getByRole('button', { name: 'Ana Odsutna', exact: true }).click()
  await dialog.getByRole('button', { name: `Ukloni nedostupnost ${dayLabel}`, exact: true }).click()
  await expect(dialog.getByRole('region', { name: 'Nedostupnost' })).toContainText('Nema zabilježene nedostupnosti.')
  await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()

  await page.getByRole('link', { name: 'Transferi' }).click()
  await expect(page).toHaveURL(/\/transfers/)
  await expect(page.getByRole('row').filter({ hasText: 'Iva Pokrivena' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Iva Pokrivena' })).not.toContainText('Nedostupan')

  await openAudit(page)
  await expect(page.getByRole('cell', { name: 'Nedostupnost dodana', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Nedostupnost uklonjena', exact: true })).toBeVisible()
})

test('a Vehicle window from one time to another, in English and the dark theme', async ({ page }) => {
  const tenant = await seedTenant('unavailability-en')
  await useTheme(page, 'dark')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await switchLocale(page, 'en')
  const driverId = await driver(page, 'Ben Roster', '+385911110356')
  const carId = await vehicle(page, 'DU356AA')
  await putRoster(page, driverId, carId)

  await page.goto('/vehicles')
  await page.getByRole('button', { name: 'DU356AA', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const section = dialog.getByRole('region', { name: 'Unavailability' })
  await expect(section).toContainText('No unavailability recorded.')
  await section.getByRole('checkbox', { name: 'Whole days' }).uncheck()
  await section.getByLabel('From', { exact: true }).fill(`${rideDay}T09:00`)
  await section.getByLabel('To', { exact: true }).fill(`${rideDay}T08:00`)
  await section.getByRole('button', { name: 'Add unavailability', exact: true }).click()
  await expect(section.getByRole('alert')).toContainText('The end must be after the start.')

  await section.getByLabel('To', { exact: true }).fill(`${rideDay}T11:00`)
  await section.getByRole('button', { name: 'Add unavailability', exact: true }).click()
  const from = formatInstant(instantFromWallClock(`${rideDay}T09:00`, zone), zone, 'en')
  const list = section.getByRole('list', { name: 'Recorded unavailability' })
  await expect(list).toContainText(from)

  await section.getByRole('button', { name: /^Change unavailability / }).click()
  await expect(section.getByRole('checkbox', { name: 'Whole days' })).not.toBeChecked()
  await expect(section.getByLabel('From', { exact: true })).toHaveValue(`${rideDay}T09:00`)
  await expect(section.getByLabel('To', { exact: true })).toHaveValue(`${rideDay}T11:00`)
  await section.getByLabel('To', { exact: true }).fill(`${rideDay}T13:00`)
  await section.getByRole('button', { name: 'Save unavailability', exact: true }).click()
  await expect(list).toContainText(`${from} – ${formatInstant(instantFromWallClock(`${rideDay}T13:00`, zone), zone, 'en')}`)
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expectNoAxeViolations(page)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.goto('/roster')
  await showRosterWeek(page, 'Previous week')
  await expect(page.getByRole('row').filter({ hasText: 'Ben Roster' })).toContainText('Vehicle unavailable')
  await expect(page.locator(`#roster-vehicle-${driverId}-${rideDay}`)).toContainText('DU356AA (unavailable)')
})
