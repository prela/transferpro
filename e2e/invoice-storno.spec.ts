import type { Page } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedMember, seedTenant } from './fixtures/seed'
import { hydrated, openUserMenu, signIn, useTheme } from './fixtures/ui'

/**
 * An Admin stornos a created invoice and issues another. A Dispatcher
 * has no Storniraj (ADR-0051). The phone project runs this block.
 * The desktop project runs it too.
 */

const licence = '2031-01-01'

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

/**
 * The Ride slideover covers the account button on a phone, and it adds
 * other menus, so Odjava is opened from Office Home.
 */
async function signOutOffice(page: Page, tenantName: string) {
  await page.goto('/')
  await hydrated(page)
  await openUserMenu(page, tenantName)
  await page.getByRole('menuitem', { name: 'Odjava', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
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
    test(`an admin stornos and reissues, and a dispatcher has no Storniraj, in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`storno-${theme}`)
      const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dana')
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      const clientId = await createdId(page, '/api/clients', { name: 'Agencija Storno', kind: 'agency' })
      const startLocationId = await createdId(page, '/api/locations', { name: 'Zračna luka', kind: 'airport' })
      const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Park', kind: 'hotel' })
      const driverId = await createdId(page, '/api/drivers', {
        name: 'Ivo Storno',
        kind: 'own',
        phone: '+385914410001',
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      })
      const vehicleId = await createdId(page, '/api/vehicles', {
        registrationPlate: `DU441${theme === 'light' ? 'A' : 'B'}`,
        kind: 'fixed',
        seatCount: 4,
        registrationExpiresOn: licence,
        technicalInspectionExpiresOn: licence,
        insuranceExpiresOn: licence,
      })
      const billing = await page.request.put(`/api/clients/${clientId}/billing-details`, {
        data: {
          legalName: 'Agencija Storno d.o.o.',
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
        data: { dueDays: 15, vatRate: 25, lineText: 'Transfer', version: 0, token: 'e2e-storno-token' },
      })
      if (!settings.ok())
        throw new Error(`${settings.status()} ${await settings.text()}`)

      const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
      const priced = await recordTransfer(page.request, {
        data: {
          clientId,
          startLocationId,
          endLocationId,
          passengerCount: 2,
          airportMark: false,
          luggageCount: 0,
          childSeatCount: 0,
          flightNumber: null,
          note: '',
          tabla: '',
          clientReference: 'V-29',
          guestName: 'Ema Storno',
          pickupAt: instantFromWallClock(`${day}T15:00`, 'Europe/Zagreb').toISOString(),
          price: 80,
          payment: 'invoice_to_agency',
        },
      })
      if (!priced.ok())
        throw new Error(`${priced.status()} ${await priced.text()}`)
      const body = await priced.json() as { transfer: { id: string }, ride: { id: string } }
      const assigned = await page.request.post(`/api/rides/${body.ride.id}/assign`, {
        data: { version: 0, driverId, vehicleId },
      })
      if (!assigned.ok())
        throw new Error(`${assigned.status()} ${await assigned.text()}`)
      const done = await page.request.post(`/api/rides/${body.ride.id}/done`, { data: {} })
      if (!done.ok())
        throw new Error(`${done.status()} ${await done.text()}`)

      await page.goto(`/transfers?day=${day}&ride=${body.ride.id}`)
      await hydrated(page)
      await page.getByRole('button', { name: 'Izdaj račun', exact: true }).click()
      const invoice = page.locator('#transfer-invoice')
      await expect(invoice).toContainText(/F-\d+/, { timeout: 20_000 })
      const firstNumber = (await invoice.textContent())?.match(/F-\d+/)?.[0]
      if (firstNumber === undefined)
        throw new Error('missing invoice number')

      await signOutOffice(page, tenant.name)
      await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
      await page.goto(`/transfers?day=${day}&ride=${body.ride.id}`)
      await hydrated(page)
      await expect(page.getByRole('button', { name: 'Storniraj', exact: true })).toHaveCount(0)
      await expectNoAxeViolations(page)

      await signOutOffice(page, tenant.name)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await page.goto(`/transfers?day=${day}&ride=${body.ride.id}`)
      await hydrated(page)
      await page.getByRole('button', { name: 'Storniraj', exact: true }).click()
      await expect(invoice).toContainText(/S-\d+/, { timeout: 20_000 })
      await expect(page.getByRole('link', { name: 'Otvori storno', exact: true })).toBeVisible()
      await expectNoAxeViolations(page)
      await page.getByRole('button', { name: 'Izdaj račun', exact: true }).click()
      // The cancelled row still shows the first number until the new invoice replaces it.
      await expect(invoice).not.toContainText(/S-\d+/, { timeout: 20_000 })
      await expect(invoice).toContainText(/F-\d+/, { timeout: 20_000 })
      const secondNumber = (await invoice.textContent())?.match(/F-\d+/)?.[0]
      expect(secondNumber).toBeTruthy()
      expect(secondNumber).not.toBe(firstNumber)
    })
  }
})
