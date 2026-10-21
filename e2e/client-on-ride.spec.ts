import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * The Client's contact persons and note on the Ride detail and the Transfer
 * form (ADR-0049). The phone project runs this block. The desktop project
 * runs it beside the table.
 */

const standing = 'Gosti se čekaju na izlazu.'
const otherNote = 'Plaćanje do 15. u mjesecu.'
const livePhone = '+385913680021'
const removedPhone = '+385913680022'

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

async function openRide(page: Page, day: string, rideId: string) {
  await page.goto(`/transfers?day=${day}&ride=${rideId}`)
  await hydrated(page)
}

/** A filled record form is kept in this browser. The next Ride must not reopen it. */
async function forgetDraft(page: Page) {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('transferpro-transfer-draft:'))
        localStorage.removeItem(key)
    }
  })
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the office sees the contacts and the note in ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`client-ride-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      const clientId = await createdId(page, '/api/clients', { name: 'Agencija Jadran', kind: 'agency' })
      const otherId = await createdId(page, '/api/clients', { name: 'Hotel Sunce', kind: 'hotel' })
      expect((await page.request.post(`/api/clients/${clientId}/contact-persons`, {
        data: { name: 'Ana Booking', role: 'Rezervacije', phone: livePhone, email: 'ana.booking@example.test' },
      })).ok()).toBeTruthy()
      const removed = await page.request.post(`/api/clients/${clientId}/contact-persons`, {
        data: { name: 'Otišla Osoba', phone: removedPhone },
      })
      expect(removed.ok()).toBeTruthy()
      const removedBody = await removed.json() as { id: string, version: number }
      expect((await page.request.post(`/api/clients/${clientId}/contact-persons/${removedBody.id}/remove`, {
        data: { version: removedBody.version },
      })).ok()).toBeTruthy()
      expect((await page.request.put(`/api/clients/${clientId}/note`, { data: { note: standing } })).ok()).toBeTruthy()
      expect((await page.request.put(`/api/clients/${otherId}/note`, { data: { note: otherNote } })).ok()).toBeTruthy()

      const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Jadran', kind: 'address' })
      const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Jadran', kind: 'hotel' })
      const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
      const recorded = await recordTransfer(page.request, {
        data: {
          clientId,
          pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
          startLocationId,
          endLocationId,
          passengerCount: 1,
          guestName: 'Iva Ured',
          price: 40,
          payment: 'cash',
          airportMark: false,
          luggageCount: 0,
          childSeatCount: 0,
        },
      })
      expect(recorded.ok()).toBeTruthy()
      const created = await recorded.json() as { ride: { id: string }, transfer: { note: string | null } }
      expect(created.transfer.note).toBeNull()

      await openRide(page, day, created.ride.id)
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/)
      const block = page.getByRole('button', { name: 'Kontakti i napomena', exact: true })
      await expect(block).toBeVisible()
      await expect(page.getByText('Ana Booking')).toHaveCount(0)
      await block.click()
      const detail = page.locator('#ride-client-office')
      await expect(detail.getByText('Ana Booking')).toBeVisible()
      await expect(detail.getByText('Rezervacije')).toBeVisible()
      await expect(detail.locator(`a[href="tel:${livePhone}"]`)).toBeVisible()
      await expect(detail.locator('a[href="mailto:ana.booking@example.test"]')).toBeVisible()
      await expect(detail.getByText(standing)).toBeVisible()
      await expect(detail.getByText('Otišla Osoba')).toHaveCount(0)
      await expect(detail.getByText(removedPhone)).toHaveCount(0)
      await expectNoAxeViolations(page)

      // Phone back follows history and can leave Transfers. Open the day list.
      await page.goto(`/transfers?day=${day}`)
      await hydrated(page)
      const addName = phone ? 'Novi transfer' : 'Zabilježi transfer'
      await page.getByRole('button', { name: addName, exact: true }).click()
      const record = page.getByRole('region', { name: 'Zabilježi transfer' })
      await expect(record).toBeVisible()
      await expect(record.locator('#transfer-client-note')).toHaveCount(0)
      await chooseOption(page, record.locator('#transfer-client'), 'Agencija Jadran')
      await expect(record.locator('#transfer-client-note')).toContainText(standing)
      await expect(record.getByLabel('Napomena', { exact: true })).toHaveValue('')
      await chooseOption(page, record.locator('#transfer-client'), 'Hotel Sunce')
      await expect(record.locator('#transfer-client-note')).toContainText(otherNote)
      await expect(record.locator('#transfer-client-note')).not.toContainText(standing)
      await expect(record.getByLabel('Napomena', { exact: true })).toHaveValue('')
      await record.getByRole('button', { name: 'Odustani', exact: true }).click()
      await forgetDraft(page)

      await openRide(page, day, created.ride.id)
      const ride = page.locator('#ride-detail')
      await ride.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
      const correct = page.getByRole('region', { name: 'Ispravi ovaj transfer' })
      await expect(correct.locator('#transfer-client-note')).toContainText(standing)
      await expect(correct.getByLabel('Napomena', { exact: true })).toHaveValue('')
      await correct.getByRole('button', { name: 'Odustani', exact: true }).click()

      await ride.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Dupliciraj', exact: true }).click()
      const duplicate = page.getByRole('region', { name: 'Zabilježi transfer' })
      await expect(duplicate.locator('#transfer-client-note')).toContainText(standing)
      await expect(duplicate.getByLabel('Napomena', { exact: true })).toHaveValue('')
      await duplicate.getByRole('button', { name: 'Odustani', exact: true }).click()
      await forgetDraft(page)

      await openRide(page, day, created.ride.id)
      await page.locator('#ride-detail').getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Povratni transfer', exact: true }).click()
      const returned = page.getByRole('region', { name: 'Zabilježi transfer' })
      await expect(returned.locator('#transfer-client-note')).toContainText(standing)
      await expect(returned.getByLabel('Napomena', { exact: true })).toHaveValue('')
    })
  }

  test('an English smoke of the block and the note', async ({ page }) => {
    test.setTimeout(90_000)
    const phone = isPhone(page)
    if (!phone)
      await page.setViewportSize({ width: 1440, height: 900 })
    const tenant = await seedTenant('client-ride-en')
    await useTheme(page, 'light')
    await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
    await switchLocale(page, 'en')

    const clientId = await createdId(page, '/api/clients', { name: 'Agencija Jadran', kind: 'agency' })
    expect((await page.request.put(`/api/clients/${clientId}/note`, { data: { note: standing } })).ok()).toBeTruthy()
    const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Jadran', kind: 'address' })
    const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Jadran', kind: 'hotel' })
    const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
    const recorded = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
        startLocationId,
        endLocationId,
        passengerCount: 1,
        guestName: 'Iva Ured',
        price: 40,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      },
    })
    expect(recorded.ok()).toBeTruthy()
    const created = await recorded.json() as { ride: { id: string } }
    await openRide(page, day, created.ride.id)
    await page.getByRole('button', { name: 'Contacts and note', exact: true }).click()
    await expect(page.locator('#ride-client-office')).toContainText('Client note')
    await expect(page.locator('#ride-client-office')).toContainText(standing)

    await page.goto(`/transfers?day=${day}`)
    await hydrated(page)
    const addName = phone ? 'New transfer' : 'Record a transfer'
    await page.getByRole('button', { name: addName, exact: true }).click()
    const record = page.getByRole('region', { name: 'Record a transfer' })
    await chooseOption(page, record.locator('#transfer-client'), 'Agencija Jadran')
    await expect(record.locator('#transfer-client-note')).toContainText('Client note')
    await expect(record.locator('#transfer-client-note')).toContainText(standing)
    await expect(record.locator('#transfer-note')).toHaveValue('')
  })
})
