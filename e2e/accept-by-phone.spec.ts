import type { APIResponse, Page } from '@playwright/test'
import { addCalendarDays, calendarDateInTimeZone, instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

const phone = '+385911113344'
const plate = 'DU107AA'
const guest = 'Iva Phone'
const licence = addCalendarDays(calendarDateInTimeZone('Europe/Zagreb', new Date()), 400)

async function createdId(response: APIResponse): Promise<string> {
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

/**
 * Records an assigned Ride whose copied flag is on, then the office accepts it by phone.
 * The audit log is /audit. The day-list button is covered separately.
 */
async function acceptByPhone(page: Page): Promise<void> {
  const driverId = await createdId(await page.request.post('/api/drivers', {
    data: {
      name: 'Marko Bez računa',
      kind: 'own',
      phone,
      drivingLicenceExpiresOn: licence,
      transportLicenceExpiresOn: licence,
    },
  }))
  const corrected = await page.request.patch(`/api/drivers/${driverId}`, { data: { mustAccept: true } })
  expect(corrected.ok()).toBeTruthy()
  const vehicleId = await createdId(await page.request.post('/api/vehicles', {
    data: {
      registrationPlate: plate,
      kind: 'fixed',
      seatCount: 4,
      registrationExpiresOn: licence,
      technicalInspectionExpiresOn: licence,
      insuranceExpiresOn: licence,
    },
  }))
  const clientId = await createdId(await page.request.post('/api/clients', {
    data: { name: 'Klijent Iva', kind: 'agency' },
  }))
  const startLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Polazak Iva', kind: 'airport' },
  }))
  const endLocationId = await createdId(await page.request.post('/api/locations', {
    data: { name: 'Dolazak Iva', kind: 'hotel' },
  }))
  const day = calendarDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
      startLocationId,
      endLocationId,
      passengerCount: 1,
      guestName: guest,
      price: 42.5,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
    },
  })
  expect(recorded.ok()).toBeTruthy()
  const body = await recorded.json() as { ride: { id: string } }
  const assigned = await page.request.post(`/api/rides/${body.ride.id}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()
  const accepted = await page.request.post(`/api/rides/${body.ride.id}/accept-by-phone`, { data: { driverId } })
  expect(accepted.ok()).toBeTruthy()
}

test('the audit log names the admin and says the acceptance was confirmed by phone', async ({ page }) => {
  const tenant = await seedTenant('phone-accept')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await acceptByPhone(page)
  await page.goto('/audit')

  const row = page.getByRole('row', { name: 'Prihvaćanje potvrđeno telefonom' })
  await expect(row).toContainText(tenant.adminName)
  await expect(row.getByRole('cell', { name: `${tenant.adminName} Prihvaćanje potvrđeno telefonom`, exact: true })).toBeVisible()
  await expect(row).not.toContainText(plate)
  await expect(row).not.toContainText(phone)
  await expect(row).not.toContainText(guest)
  await expect(row).not.toContainText('Marko Bez računa')

  await useTheme(page, 'dark')
  await page.reload()
  await expect(page.getByRole('row', { name: 'Prihvaćanje potvrđeno telefonom' })).toContainText(tenant.adminName)

  await switchLocale(page, 'en')
  const english = page.getByRole('row', { name: 'Acceptance confirmed by phone' })
  await expect(english).toContainText(tenant.adminName)
  await expect(english.getByRole('cell', { name: `${tenant.adminName} Acceptance confirmed by phone`, exact: true })).toBeVisible()
  await expect(english).not.toContainText(plate)
  await expect(english).not.toContainText(phone)
  await expect(english).not.toContainText(guest)
  await expect(english).not.toContainText('Marko Bez računa')
})

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

test.describe('@phone', () => {
  test('a reassignment between opening and confirming shows the new message and leaves the ride assigned', async ({ page }) => {
    test.setTimeout(180_000)
    await pinOperationalClock(page)
    const tenant = await seedTenant('phone-accept-changed')
    const mail: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('resend.com'))
        mail.push(request.url())
    })
    const guest = 'Iva Zamjena'
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    const calledId = await createdId(await page.request.post('/api/drivers', {
      data: {
        name: 'Marko Zvan',
        kind: 'own',
        phone: '+385911115760',
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      },
    }))
    const replacementId = await createdId(await page.request.post('/api/drivers', {
      data: {
        name: 'Ivo Novi',
        kind: 'own',
        phone: '+385911115761',
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      },
    }))
    expect((await page.request.patch(`/api/drivers/${calledId}`, { data: { mustAccept: true } })).ok()).toBeTruthy()
    expect((await page.request.patch(`/api/drivers/${replacementId}`, { data: { mustAccept: true } })).ok()).toBeTruthy()
    const vehicleId = await createdId(await page.request.post('/api/vehicles', {
      data: {
        registrationPlate: 'DU575AA',
        kind: 'fixed',
        seatCount: 4,
        registrationExpiresOn: licence,
        technicalInspectionExpiresOn: licence,
        insuranceExpiresOn: licence,
      },
    }))
    const clientId = await createdId(await page.request.post('/api/clients', {
      data: { name: 'Klijent Iva Zamjena', kind: 'agency' },
    }))
    const startLocationId = await createdId(await page.request.post('/api/locations', {
      data: { name: 'Polazak Iva Zamjena', kind: 'airport' },
    }))
    const endLocationId = await createdId(await page.request.post('/api/locations', {
      data: { name: 'Dolazak Iva Zamjena', kind: 'hotel' },
    }))
    const day = operationalDay(page)
    const recorded = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T16:00`, 'Europe/Zagreb').toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: guest,
        price: 42.5,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    expect(recorded.ok()).toBeTruthy()
    const rideId = (await recorded.json() as { ride: { id: string } }).ride.id
    expect((await page.request.post(`/api/rides/${rideId}/assign`, {
      data: { version: 0, driverId: calledId, vehicleId },
    })).ok()).toBeTruthy()
    await page.getByRole('link', { name: 'Transferi', exact: true }).click()

    async function driverNow(): Promise<{ driverId: string, version: number }> {
      const response = await page.request.get('/api/transfers', { params: { date: day } })
      expect(response.ok()).toBeTruthy()
      const body = await response.json() as {
        rides: { guestName: string, driverId: string | null, version: number, state: string }[]
      }
      const ride = body.rides.find(row => row.guestName === guest)
      if (!ride?.driverId)
        throw new Error('missing driver')
      return { driverId: ride.driverId, version: ride.version }
    }

    await page.getByRole('button', { name: `Potvrdi telefonom: ${guest}` }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Zabilježi prihvaćanje telefonom')
    await expectNoAxeViolations(page)
    const shown = await driverNow()
    const moved = await page.request.post(`/api/rides/${rideId}/reassign`, {
      data: { version: shown.version, driverId: replacementId, vehicleId },
    })
    expect(moved.ok(), moved.ok() ? '' : await moved.text()).toBeTruthy()
    const refused = page.waitForResponse(response =>
      response.url().includes(`/api/rides/${rideId}/accept-by-phone`) && response.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'Zabilježi prihvaćanje', exact: true }).click()
    const response = await refused
    expect(response.status()).toBe(409)
    expect((response.request().postDataJSON() as { driverId?: string }).driverId).toBe(calledId)
    await expect(dialog.getByText('Vozač ove vožnje je u međuvremenu promijenjen.')).toBeVisible()
    expect((await driverNow()).driverId).toBe(replacementId)
    expect(mail).toEqual([])
    await dialog.getByRole('button', { name: 'Odustani', exact: true }).click()
    await page.locator('#ride-detail header').getByRole('button', { name: isPhone(page) ? 'Natrag' : 'Zatvori', exact: true }).click()

    await switchTheme(page, 'dark')
    await switchLocale(page, 'en')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.getByRole('button', { name: `Confirm by phone: ${guest}` }).click()
    await expect(dialog).toContainText('Record acceptance by phone')
    const shownAgain = await driverNow()
    expect(shownAgain.driverId).toBe(replacementId)
    const movedBack = await page.request.post(`/api/rides/${rideId}/reassign`, {
      data: { version: shownAgain.version, driverId: calledId, vehicleId },
    })
    expect(movedBack.ok(), movedBack.ok() ? '' : await movedBack.text()).toBeTruthy()
    const refusedAgain = page.waitForResponse(response =>
      response.url().includes(`/api/rides/${rideId}/accept-by-phone`) && response.request().method() === 'POST',
    )
    await dialog.getByRole('button', { name: 'Record acceptance', exact: true }).click()
    expect((await refusedAgain).status()).toBe(409)
    await expect(dialog.getByText('The Driver of this ride has changed in the meantime.')).toBeVisible()
    await expectNoAxeViolations(page)
    expect((await driverNow()).driverId).toBe(calledId)
    const stored = await page.request.get('/api/transfers', { params: { date: day } })
    const storedBody = await stored.json() as { rides: { guestName: string, state: string }[] }
    expect(storedBody.rides.find(row => row.guestName === guest)?.state).toBe('assigned')
    expect(mail).toEqual([])
  })
})
