import type { Page } from '@playwright/test'
import pg from 'pg'
import { instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { seedTenant } from './fixtures/seed'
import { hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Unsent and failed invoices in Pozornost, and the payment-reporting
 * reminder on a pinned clock (ADR-0051). The phone project runs this
 * block. The desktop project runs it too.
 */

const pinned = new Date('2026-10-15T10:00:00.000Z')
const zone = 'Europe/Zagreb'

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '')
    throw new Error(`${name} is required`)
  return value
}

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

async function insertInvoice(input: {
  tenantId: string
  transferId: string
  clientId: string
  state: 'created' | 'failed' | 'sent'
  language: 'hr' | 'en'
}): Promise<void> {
  const pool = new pg.Pool({ connectionString: required('DATABASE_MIGRATE_URL'), max: 1 })
  try {
    // Done, so the Ride is a Warning and not an urgent unassigned row.
    await pool.query(
      `update app.rides set state = 'done' where tenant_id = $1 and transfer_id = $2`,
      [input.tenantId, input.transferId],
    )
    await pool.query(
      `insert into app.invoices (
        tenant_id, transfer_reference, state, client_id, line_text, language,
        due_days, vat_rate, gross_amount, reason, asked_by
      ) values ($1, $2, $3, $4, 'Transfer', $5, 15, 25, '80.00', $6, 'office')`,
      [
        input.tenantId,
        input.transferId,
        input.state,
        input.clientId,
        input.language,
        input.state === 'failed' ? 'unavailable' : null,
      ],
    )
  }
  finally {
    await pool.end()
  }
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`Pozornost shows an unsent invoice, a failed invoice, and the reminder in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      await pinOperationalClock(page, pinned)
      await page.route('**/api/office-home', async (route) => {
        const headers = route.request().headers()
        headers['x-office-now'] = pinned.toISOString()
        await route.continue({ headers })
      })
      await useTheme(page, theme)
      const tenant = await seedTenant(`attention-${theme}`)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      const clientId = await createdId(page, '/api/clients', { name: 'Agencija Pozornost', kind: 'agency' })
      const startLocationId = await createdId(page, '/api/locations', { name: 'Zračna luka', kind: 'airport' })
      const endLocationId = await createdId(page, '/api/locations', { name: 'Hotel Park', kind: 'hotel' })
      const day = '2026-10-15'
      const pickup = instantFromWallClock(`${day}T12:00`, zone).toISOString()
      async function record(guestName: string): Promise<string> {
        const response = await page.request.post('/api/transfers', {
          data: {
            externalId: crypto.randomUUID(),
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
            clientReference: null,
            guestName,
            pickupAt: pickup,
            price: 80,
            payment: 'invoice_to_agency',
          },
        })
        if (!response.ok())
          throw new Error(`${response.status()} ${await response.text()}`)
        const body = await response.json() as { transfer: { id: string } }
        return body.transfer.id
      }
      const unsentId = await record('Neposlana Iva')
      const failedId = await record('Neuspjela Mia')
      const sentId = await record('Poslani domaći')
      await insertInvoice({
        tenantId: tenant.tenantId,
        transferId: unsentId,
        clientId,
        state: 'created',
        language: 'hr',
      })
      await insertInvoice({
        tenantId: tenant.tenantId,
        transferId: failedId,
        clientId,
        state: 'failed',
        language: 'hr',
      })
      await insertInvoice({
        tenantId: tenant.tenantId,
        transferId: sentId,
        clientId,
        state: 'sent',
        language: 'hr',
      })

      await page.goto('/')
      await hydrated(page)
      const attention = page.getByRole('region', { name: 'Pozornost' })
      await expect(attention.getByText('Neposlana Iva')).toBeVisible()
      await expect(attention.getByText('Pošalji iz alata za račune')).toBeVisible()
      await expect(attention.getByRole('link', { name: 'Pokušaj ponovno: Neuspjela Mia' })).toBeVisible()
      await expect(attention.getByText('Prijavite plaćanja za prošli mjesec u alatu za račune.')).toBeVisible()
      await expect(attention.getByText('Nema hitnih vožnji. Ostale vožnje su na popisima ispod.')).toHaveCount(0)
      await expectNoAxeViolations(page)

      if (theme === 'dark') {
        await switchLocale(page, 'en')
        await hydrated(page)
        const english = page.getByRole('region', { name: 'Attention' })
        await expect(english.getByText('Send from the invoicing tool')).toBeVisible()
        await expect(english.getByRole('link', { name: 'Try again: Neuspjela Mia' })).toBeVisible()
        await expect(english.getByText('Report last month\'s payments in the invoicing tool.')).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})
