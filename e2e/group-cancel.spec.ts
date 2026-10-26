import type { APIRequestContext, Page } from '@playwright/test'
import { instantFromWallClock } from '../shared/date'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { openRideMenu, signIn, switchLocale } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

function row(page: Page, guest: string) {
  return page.getByRole('row', { name: guest })
}

async function place(request: APIRequestContext, name: string, kind: 'airport' | 'hotel') {
  const response = await request.post('/api/locations', { data: { name, kind } })
  expect(response.ok()).toBeTruthy()
  return (await response.json() as { id: string }).id
}

test('a main Transfer asks before cancelling the whole group', async ({ page }) => {
  const tenant = await seedTenant('group-cancel')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const client = await page.request.post('/api/clients', {
    data: { name: 'Klijent Grupa', kind: 'agency' },
  })
  expect(client.ok()).toBeTruthy()
  const clientId = (await client.json() as { id: string }).id
  const startLocationId = await place(page.request, 'Polazak Grupa', 'airport')
  const endLocationId = await place(page.request, 'Dolazak Grupa', 'hotel')
  const day = operationalDay(page)
  const pickupAt = instantFromWallClock(`${day}T10:00`, 'Europe/Zagreb').toISOString()

  async function record(guest: string, extra?: { mainTransferId: string, groupPassengerCount?: number, mainVersion?: number }) {
    const response = await recordTransfer(page.request, {
      data: {
        clientId,
        pickupAt,
        startLocationId,
        endLocationId,
        passengerCount: 2,
        guestName: guest,
        price: extra === undefined ? 42.5 : 0,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
        ...(extra === undefined
          ? {}
          : {
              mainTransferId: extra.mainTransferId,
              ...(extra.groupPassengerCount === undefined
                ? {}
                : { groupPassengerCount: extra.groupPassengerCount, mainVersion: extra.mainVersion }),
            }),
      },
    })
    expect(response.ok()).toBeTruthy()
    return await response.json() as { transfer: { id: string }, ride: { id: string } }
  }

  const main = await record('Iva Glavni')
  await record('Iva Prvo', { mainTransferId: main.transfer.id, groupPassengerCount: 8, mainVersion: 0 })
  await record('Iva Drugo', { mainTransferId: main.transfer.id })
  await record('Iva Sama')

  await page.getByRole('link', { name: 'Transferi' }).click()

  await openRideMenu(page, 'Iva Sama')
  await page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true }).click()
  const alone = page.getByRole('dialog', { name: 'Otkaži vožnju' })
  await expect(alone).toBeVisible()
  await expect(alone).not.toContainText('Grupa ima još')
  await alone.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(alone).toHaveCount(0)

  const cancels: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/cancel'))
      cancels.push(request.url())
  })

  await openRideMenu(page, 'Iva Glavni')
  await page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true }).click()
  const group = page.getByRole('dialog', { name: 'Otkaži transfer' })
  await expect(group).toContainText('Grupa ima još 2 vozila. Otkaži cijelu grupu?')
  await group.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(group).toHaveCount(0)
  expect(cancels).toEqual([])
  await expect(row(page, 'Iva Glavni').getByRole('cell', { name: 'Otkazano', exact: true })).toHaveCount(0)
  await expect(row(page, 'Iva Prvo').getByRole('cell', { name: 'Otkazano', exact: true })).toHaveCount(0)

  await switchLocale(page, 'en')
  await page.getByRole('link', { name: 'Transfers' }).click()
  await openRideMenu(page, 'Iva Glavni')
  await page.getByRole('menuitem', { name: 'Cancel ride', exact: true }).click()
  const english = page.getByRole('dialog', { name: 'Cancel the transfer' })
  await expect(english).toContainText('The group still has 2 vehicles. Cancel the whole group?')
  await english.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(english).toHaveCount(0)
  expect(cancels).toEqual([])

  await switchLocale(page, 'hr')
  await page.getByRole('link', { name: 'Transferi' }).click()
  await openRideMenu(page, 'Iva Glavni')
  await page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: 'Otkaži transfer' })
  await confirm.getByRole('button', { name: 'Otkaži cijelu grupu', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Vožnja otkazana' })).toHaveCount(1)
  await expect(row(page, 'Iva Glavni').getByRole('cell', { name: 'Otkazano', exact: true })).toBeVisible()
  await expect(row(page, 'Iva Prvo').getByRole('cell', { name: 'Otkazano', exact: true })).toBeVisible()
  await expect(row(page, 'Iva Drugo').getByRole('cell', { name: 'Otkazano', exact: true })).toBeVisible()
  await expect(row(page, 'Iva Sama').getByRole('cell', { name: 'Otkazano', exact: true })).toHaveCount(0)
  expect(cancels).toHaveLength(1)
})
