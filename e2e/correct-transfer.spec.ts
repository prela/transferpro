import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn, signOut, switchLocale, switchTheme } from './fixtures/ui'

function notice(page: Page, title: string, sentence: string) {
  return page.getByRole('listitem').filter({ hasText: title }).filter({ hasText: sentence })
}

const guest = 'Ana Ispravak'
const renamed = 'Iva Ispravak'

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

test('the office corrects a Transfer, and a flight change returns an accepted Ride for the Driver', async ({ page }) => {
  test.setTimeout(120_000)
  const tenant = await seedTenant('correct-transfer')
  const driver = await seedMember(tenant.tenantId, 'driver', 'Vozac')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const licence = '2031-01-01'
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Marko Ispravak',
    kind: 'own',
    phone: '+385911110026',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
    memberUserId: driver.userId,
  })
  await page.request.patch(`/api/drivers/${driverId}`, { data: { mustAccept: true } })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU026AA',
    kind: 'fixed',
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Ispravak', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Ispravak', kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Ispravak', kind: 'hotel' })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      flightNumber: 'OU384',
      price: 42.5,
      payment: 'cash',
      airportMark: true,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
  expect((await page.request.post(`/api/rides/${rideId}/assign`, { data: { driverId, vehicleId } })).ok()).toBeTruthy()
  expect((await page.request.post(`/api/rides/${rideId}/accept-by-phone`, { data: {} })).ok()).toBeTruthy()

  const finishedGuest = 'Leo Kraj'
  const finished = await page.request.post('/api/transfers', {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T13:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: finishedGuest,
      price: 10,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(finished.ok()).toBeTruthy()
  const finishedRideId = (await finished.json() as { ride: { id: string } }).ride.id
  expect((await page.request.post(`/api/rides/${finishedRideId}/cancel`, { data: {} })).ok()).toBeTruthy()

  await page.goto('/transfers')
  await expect(page.getByRole('button', { name: `Radnje: ${finishedGuest}` })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Otkazano' })).toBeVisible()
  await page.getByRole('button', { name: `Radnje: ${guest}` }).click()
  await page.getByRole('menuitem', { name: 'Ispravi', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Broj leta').fill('OU392')
  await dialog.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('status').getByText('Ispravljeno.')).toBeVisible()
  await expect(notice(page, 'Ispravljeno.', 'Radni nalog je poslan vozaču Marko Ispravak.')).toHaveCount(1)
  await expect(page.getByText(driver.email)).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Dodijeljeno' })).toBeVisible()
  await expect(page.getByRole('button', { name: `Zabilježi prihvaćanje telefonom: ${guest}` })).toBeVisible()

  await switchTheme(page, 'dark')
  await expect(page.getByRole('cell', { name: 'Dodijeljeno' })).toBeVisible()
  await switchLocale(page, 'en')
  await expect(page.getByRole('button', { name: `Actions: ${guest}` })).toBeVisible()
  await page.getByRole('button', { name: `Actions: ${guest}` }).click()
  await page.getByRole('menuitem', { name: 'Correct', exact: true }).click()
  let correctDialog = page.getByRole('dialog')
  await correctDialog.getByLabel('Guest name').fill(renamed)
  await correctDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(correctDialog).toBeHidden()
  await expect(page.getByRole('cell', { name: guest, exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Actions: ${guest}` }).click()
  await page.getByRole('menuitem', { name: 'Correct', exact: true }).click()
  correctDialog = page.getByRole('dialog')
  await correctDialog.getByLabel('Guest name').fill(renamed)
  await correctDialog.getByRole('button', { name: 'Save correction', exact: true }).click()
  await expect(page.getByRole('status').getByText('Corrected.')).toBeVisible()
  await expect(notice(page, 'Corrected.', 'Work order sent to Marko Ispravak.')).toHaveCount(1)
  await expect(page.getByText(driver.email)).toHaveCount(0)
  await expect(page.getByRole('cell', { name: renamed, exact: true })).toBeVisible()
  await switchTheme(page, 'light')
  await expect(page.getByRole('cell', { name: renamed, exact: true })).toBeVisible()

  await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: 'Audit log', exact: true }).click()
  await expect(page).toHaveURL(/\/audit$/)
  const returned = page.getByRole('row', { name: 'Ride returned to assigned' })
  await expect(returned.getByRole('cell', { name: tenant.adminName })).toBeVisible()
  await expect(returned).not.toContainText(renamed)
  await expect(returned).not.toContainText('OU392')

  await switchLocale(page, 'hr')
  await signOut(page)
  await signIn(page, driver.email, driver.password, tenant.name)
  await expect(page.getByText('Čeka na prihvat')).toBeVisible()
  await page.getByRole('button', { name: 'Odbi vožnju', exact: true }).click()
  const declineDialog = page.getByRole('dialog')
  const declineResponse = page.waitForResponse(response =>
    response.url().includes('/decline') && response.request().method() === 'POST',
  )
  await declineDialog.getByRole('button', { name: 'Odbi', exact: true }).click()
  expect((await declineResponse).status()).toBe(200)
  await expect(declineDialog).toBeHidden()
  await expect(page.getByText('Nemate nadolazećih vožnji.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Odjava', exact: true })).toBeVisible()

  await signOut(page)
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await page.goto('/transfers')
  await expect(page.getByText(`Marko Ispravak je odbio vožnju za ${renamed}.`)).toBeVisible()
})
