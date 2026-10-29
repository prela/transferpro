import type { Page } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, useTheme } from './fixtures/ui'

/**
 * Issue an invoice from the Ride detail (ADR-0051, ADR-0053).
 * The phone project runs this block. The desktop project runs it too.
 */

const licence = '2031-01-01'

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the office issues an invoice in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`invoice-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      const clientId = await createdId(page, '/api/clients', { name: 'Agencija Račun', kind: 'agency' })
      const startLocationId = await createdId(page, '/api/locations', { name: 'Zračna luka', kind: 'airport' })
      const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Park', kind: 'hotel' })
      const driverId = await createdId(page, '/api/drivers', {
        name: 'Ivo Račun',
        kind: 'own',
        phone: '+385914390001',
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      })
      const vehicleId = await createdId(page, '/api/vehicles', {
        registrationPlate: `DU439${theme === 'light' ? 'A' : 'B'}`,
        kind: 'fixed',
        registrationExpiresOn: licence,
        technicalInspectionExpiresOn: licence,
        insuranceExpiresOn: licence,
      })
      const billing = await page.request.put(`/api/clients/${clientId}/billing-details`, {
        data: {
          legalName: 'Agencija Račun d.o.o.',
          country: 'HR',
          oib: '12345678903',
          vatId: null,
          address: 'Obala 1, Split',
          guestNameOnInvoice: false,
        },
      })
      if (!billing.ok())
        throw new Error(`${billing.status()} ${await billing.text()}`)
      const settings = await page.request.put('/api/invoicing-settings', {
        data: { dueDays: 15, vatRate: 25, lineText: 'Transfer', version: 0, token: 'e2e-invoice-token' },
      })
      if (!settings.ok())
        throw new Error(`${settings.status()} ${await settings.text()}`)

      const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
      const booking = {
        clientId,
        startLocationId,
        endLocationId,
        passengerCount: 4,
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
        flightNumber: null,
        note: '',
        tabla: '',
        clientReference: 'V-19',
      }
      const priced = await recordTransfer(page.request, {
        data: {
          ...booking,
          guestName: 'Iva Račun',
          pickupAt: instantFromWallClock(`${day}T15:00`, 'Europe/Zagreb').toISOString(),
          price: 80,
          payment: 'invoice_to_agency',
        },
      })
      if (!priced.ok())
        throw new Error(`${priced.status()} ${await priced.text()}`)
      const pricedBody = await priced.json() as { transfer: { id: string, version: number }, ride: { id: string } }
      const free = await recordTransfer(page.request, {
        data: {
          ...booking,
          guestName: 'Nula Račun',
          pickupAt: instantFromWallClock(`${day}T16:00`, 'Europe/Zagreb').toISOString(),
          price: 0,
          payment: 'invoice_to_agency',
        },
      })
      if (!free.ok())
        throw new Error(`${free.status()} ${await free.text()}`)
      const freeBody = await free.json() as { ride: { id: string } }

      for (const rideId of [pricedBody.ride.id, freeBody.ride.id]) {
        const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
          data: { version: 0, driverId, vehicleId },
        })
        if (!assigned.ok())
          throw new Error(`${assigned.status()} ${await assigned.text()}`)
        const done = await page.request.post(`/api/rides/${rideId}/done`, { data: {} })
        if (!done.ok())
          throw new Error(`${done.status()} ${await done.text()}`)
      }

      await page.goto(`/transfers?day=${day}`)
      await hydrated(page)
      await expect(page.getByRole('button', { name: /Za fakturiranje \(1\)/ })).toBeVisible()
      await page.getByRole('button', { name: /Za fakturiranje \(1\)/ }).click()
      await expect(page.getByText('Iva Račun')).toBeVisible()
      await expect(page.getByText('Nula Račun')).toHaveCount(0)

      const openPriced = phone
        ? page.getByRole('listitem').filter({ hasText: 'Iva Račun' })
        : page.getByRole('row', { name: 'Iva Račun' })
      await openPriced.locator('time').first().click()
      await page.getByRole('button', { name: 'Izdaj račun', exact: true }).click()
      await expect(page.locator('#transfer-invoice')).toContainText(/F-\d+/, { timeout: 20_000 })
      await expect(page.getByRole('link', { name: 'Otvori račun', exact: true })).toBeVisible()
      await expectNoAxeViolations(page)

      await page.goto(`/transfers?day=${day}&filter=toInvoice`)
      await hydrated(page)
      await expect(page.getByRole('button', { name: /Za fakturiranje \(0\)/ })).toBeVisible()

      await page.goto(`/transfers?day=${day}&ride=${freeBody.ride.id}`)
      await hydrated(page)
      await expect(page.getByRole('button', { name: 'Izdaj račun', exact: true })).toHaveCount(0)

      await page.goto(`/transfers?day=${day}&ride=${pricedBody.ride.id}`)
      await hydrated(page)
      await page.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
      await page.getByLabel(/Cijena/).fill('90')
      await page.getByRole('button', { name: 'Spremi ispravak', exact: true }).click()
      await expect(page.getByText('Ovaj transfer već ima račun.')).toBeVisible()
      const listed = await (await page.request.get(`/api/transfers?date=${day}`)).json() as {
        rides: { transferId: string, version: number }[]
      }
      const version = listed.rides.find(ride => ride.transferId === pricedBody.transfer.id)?.version
      const refused = await page.request.patch(`/api/transfers/${pricedBody.transfer.id}`, {
        data: {
          ...booking,
          guestName: 'Iva Račun',
          pickupAt: instantFromWallClock(`${day}T15:00`, 'Europe/Zagreb').toISOString(),
          price: 90,
          payment: 'invoice_to_agency',
          version,
        },
      })
      expect(refused.status()).toBe(409)
      const refusedBody = await refused.json() as { code?: string, data?: { code?: string } }
      expect(refusedBody.data?.code ?? refusedBody.code).toBe('transfer_invoiced')
    })
  }
})
