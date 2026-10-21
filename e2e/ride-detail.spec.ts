import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock, operationalDateInTimeZone } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Ride detail (issue #256). The phone project runs the @phone block.
 * The desktop project runs it too, at the beside-the-table width.
 * Changed specs that still named the old command dialogs are updated in place.
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

async function listScroll(page: Page): Promise<number> {
  return page.evaluate(() => {
    const start = document.getElementById('transfer-day-list')
    let node = start?.parentElement ?? null
    while (node) {
      const overflow = getComputedStyle(node).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1)
        return node.scrollTop
      node = node.parentElement
    }
    return window.scrollY
  })
}

async function scrollList(page: Page, top: number) {
  await page.evaluate((y) => {
    const start = document.getElementById('transfer-day-list')
    let node = start?.parentElement ?? null
    while (node) {
      const overflow = getComputedStyle(node).overflowY
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollHeight > node.clientHeight + 1) {
        node.scrollTop = y
        return
      }
      node = node.parentElement
    }
    window.scrollTo(0, y)
  }, top)
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the ride detail follows ${theme}`, async ({ page }) => {
      test.setTimeout(120_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`ride-detail-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

      const driverId = await createdId(page, '/api/drivers', {
        name: 'Ana Prva',
        kind: 'own',
        phone: '+385911110256',
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      })
      await createdId(page, '/api/drivers', {
        name: 'Ana Druga',
        kind: 'own',
        phone: '+385911110257',
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      })
      const acceptDriverId = await createdId(page, '/api/drivers', {
        name: 'Ana Prihvat',
        kind: 'own',
        phone: '+385911110258',
        drivingLicenceExpiresOn: licence,
        transportLicenceExpiresOn: licence,
      })
      expect((await page.request.patch(`/api/drivers/${acceptDriverId}`, { data: { mustAccept: true } })).ok()).toBeTruthy()
      const vehicleId = await createdId(page, '/api/vehicles', {
        registrationPlate: 'DU256AA',
        kind: 'fixed',
        registrationExpiresOn: licence,
        technicalInspectionExpiresOn: licence,
        insuranceExpiresOn: licence,
      })
      const otherVehicleId = await createdId(page, '/api/vehicles', {
        registrationPlate: 'DU256BB',
        kind: 'fixed',
        registrationExpiresOn: licence,
        technicalInspectionExpiresOn: licence,
        insuranceExpiresOn: licence,
      })
      const clientId = await createdId(page, '/api/clients', { name: 'Klijent Detalj', kind: 'agency' })
      const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Detalj', kind: 'airport' })
      const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Detalj', kind: 'hotel' })
      const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
      const booking = {
        clientId,
        startLocationId,
        endLocationId,
        passengerCount: 1,
        price: 42.5,
        payment: 'cash',
        airportMark: false,
        luggageCount: 0,
        childSeatCount: 0,
      }
      async function record(guestName: string, wall: string) {
        const recorded = await recordTransfer(page.request, {
          data: {
            ...booking,
            guestName,
            flightNumber: 'OU384',
            pickupAt: instantFromWallClock(`${day}T${wall}`, 'Europe/Zagreb').toISOString(),
          },
        })
        expect(recorded.ok()).toBeTruthy()
        return await recorded.json() as { transfer: { id: string }, ride: { id: string } }
      }

      const main = await record('Iva Detalj', '08:00')
      const accept = await record('Iva Prihvat', '09:00')
      if (phone) {
        for (let index = 0; index < 12; index++)
          await record(`Iva Red ${index}`, `${10 + Math.floor(index / 2)}:${index % 2 === 0 ? '00' : '30'}`)
      }
      expect((await page.request.put('/api/roster', {
        data: { rosterDate: day, driverId, vehicleId },
      })).ok()).toBeTruthy()
      expect((await page.request.post(`/api/rides/${accept.ride.id}/assign`, {
        data: { version: 0, driverId: acceptDriverId, vehicleId: otherVehicleId },
      })).ok()).toBeTruthy()

      await page.goto(`/transfers?day=${day}`)
      await hydrated(page)
      if (phone) {
        await page.getByRole('button', { name: /^Nedodijeljeno \(/ }).click()
        await expect(page).toHaveURL(/filter=unassigned/)
        await scrollList(page, 600)
        await expect.poll(() => listScroll(page)).toBeGreaterThan(100)
        const saved = await listScroll(page)
        await page.getByRole('listitem').filter({ hasText: 'Iva Detalj' }).click()
        await expect(page).toHaveURL(new RegExp(`ride=${main.ride.id}`))
        await expect(page).toHaveURL(/filter=unassigned/)
        await expect(page.getByRole('button', { name: 'Natrag', exact: true })).toBeVisible()
        await expect(page.locator('nav.fixed')).toHaveCount(0)
        await page.getByRole('button', { name: 'Natrag', exact: true }).click()
        await expect(page).toHaveURL(/filter=unassigned/)
        await expect(page).not.toHaveURL(/ride=/)
        await expect.poll(() => listScroll(page)).toBeGreaterThan(saved - 80)
        // Back must restore the list entry, not an entry that still carries ?ride=.
        await page.goForward()
        await expect(page).toHaveURL(new RegExp(`ride=${main.ride.id}`))
        await page.goBack()
        await expect(page).not.toHaveURL(/ride=/)
        await expect(page).toHaveURL(/filter=unassigned/)
        await expect.poll(() => listScroll(page)).toBeGreaterThan(saved - 80)
        await page.getByRole('button', { name: /^Sve \(/ }).click()
      }
      await page.goto(`/transfers?day=${day}&ride=${main.ride.id}`)
      await hydrated(page)
      await expect(page).toHaveURL(new RegExp(`ride=${main.ride.id}`))
      await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Detalj' })).toBeVisible()
      if (phone) {
        await expect(page.locator('nav.fixed')).toHaveCount(0)
      }
      else {
        await expect(page.locator('#ride-detail')).toBeVisible()
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()
      }

      if (!phone)
        await page.getByRole('row', { name: 'Iva Detalj' }).click()
      await page.getByRole('button', { name: 'Dodijeli', exact: true }).click()
      if (phone) {
        await page.getByRole('button', { name: /Ana Prva/ }).click()
        await expect(page.getByRole('combobox', { name: 'Vozilo' })).toContainText('DU256AA')
      }
      else {
        await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), 'Ana Prva')
        await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), 'DU256AA')
      }
      await page.getByRole('button', { name: 'Dodijeli vožnju', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Vozač Ana Prva nema e-poštu. Radni nalog nije poslan.' })).toBeVisible()
      await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Detalj' })).toBeVisible()

      await page.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Prebaci', exact: true }).click()
      await chooseOption(page, page.getByRole('combobox', { name: 'Vozač' }), 'Ana Druga')
      await chooseOption(page, page.getByRole('combobox', { name: 'Vozilo' }), 'DU256BB')
      await page.getByRole('button', { name: 'Prebaci vožnju', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Vozač Ana Druga nema e-poštu. Radni nalog nije poslan.' })).toBeVisible()
      await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Detalj' })).toBeVisible()

      await page.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Ukloni dodjelu', exact: true }).click()
      const clearDialog = page.getByRole('dialog', { name: 'Uklanjanje dodjele' })
      await clearDialog.getByRole('button', { name: 'Ukloni dodjelu', exact: true }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Dodjela uklonjena' })).toBeVisible()
      await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Detalj' })).toBeVisible()
      if (phone)
        await page.getByRole('button', { name: 'Natrag', exact: true }).click()
      else
        await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()

      const openAccept = phone
        ? page.getByRole('listitem').filter({ hasText: 'Iva Prihvat' })
        : page.getByRole('row', { name: 'Iva Prihvat' })
      await openAccept.locator('time').first().click()
      await page.getByRole('button', { name: 'Potvrdi telefonom', exact: true }).click()
      await expect(page.getByText('Ovo bilježi prihvaćanje potvrđeno s vozačem telefonom.')).toBeVisible()
      await page.getByRole('button', { name: 'Zabilježi prihvaćanje', exact: true }).click()
      await expect(page.getByText('Prihvaćeno').first()).toBeVisible()

      await page.goto(`/transfers?day=${day}&ride=${main.ride.id}`)
      await hydrated(page)
      await page.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Ispravi transfer', exact: true }).click()
      const flight = page.getByLabel('Broj leta')
      await flight.fill('OU111')
      expect((await page.request.patch(`/api/transfers/${main.transfer.id}`, {
        data: {
          ...booking,
          guestName: 'Iva Detalj',
          flightNumber: 'OU999',
          pickupAt: instantFromWallClock(`${day}T08:00`, 'Europe/Zagreb').toISOString(),
          // Assign, reassign, and clear each claimed a version. This is the one the form holds.
          version: 3,
        },
      })).ok()).toBeTruthy()
      const refreshed = page.waitForResponse(response =>
        response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/transfers' && response.ok(),
      )
      // The phone detail is modal, so the refresh control behind it is inert.
      await page.evaluate(() => {
        document.querySelectorAll('[inert]').forEach(el => el.removeAttribute('inert'))
        const button = [...document.querySelectorAll('button')].find(el => el.textContent?.includes('Osvježi'))
        button?.click()
      })
      await refreshed
      await expect(page.getByText('Vožnja je promijenjena')).toBeVisible()
      await expect(flight).toHaveValue('OU111')

      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Detalj' })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})

/**
 * Issue #348. Opening a Ride pushes `?ride=` only after the office middleware
 * finishes GET /api/session. Closing while that push is still waiting must
 * win: the address never gains `?ride=` again, and a reload stays on the list.
 */
test('a close wins over a ride push still waiting on the session', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('ride-close-stale')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const clientId = await createdId(page, '/api/clients', { name: 'Klijent Ostaje', kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: 'Polazak Ostaje', kind: 'address' })
  const endLocationId = await createdId(page, '/api/locations', { name: 'Dolazak Ostaje', kind: 'hotel' })
  const day = operationalDateInTimeZone('Europe/Zagreb', new Date())
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      startLocationId,
      endLocationId,
      passengerCount: 1,
      price: 18,
      payment: 'cash',
      airportMark: false,
      luggageCount: 0,
      childSeatCount: 0,
      guestName: 'Iva Ostaje',
      pickupAt: instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString(),
    },
  })
  expect(recorded.ok()).toBeTruthy()

  await page.goto(`/transfers?day=${day}`)
  await hydrated(page)

  // Hold GET /api/session in the page. The office middleware awaits that
  // fetch before the router push writes ?ride=, and Chromium's memory cache
  // hides the repeat from a network route.
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    const pending: Array<() => void> = []
    window.fetch = (input, init) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      if (!url.includes('/api/session'))
        return original(input, init)
      return new Promise((resolve, reject) => {
        pending.push(() => {
          original(input, init).then(resolve, reject)
        })
      })
    }
    Reflect.set(window, '__sessionPending', pending)
  })

  await page.getByRole('row', { name: 'Iva Ostaje' }).click()
  await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Ostaje' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => {
    const pending = Reflect.get(window, '__sessionPending')
    return Array.isArray(pending) ? pending.length : 0
  })).toBeGreaterThan(0)
  // The detail is open from local state. The push has not written ?ride= yet.
  await expect(page).not.toHaveURL(/[?&]ride=/)

  await page.evaluate(() => {
    const writes: string[] = []
    const originalPush = history.pushState.bind(history)
    const originalReplace = history.replaceState.bind(history)
    history.pushState = (data, unused, url) => {
      writes.push(String(url ?? ''))
      originalPush(data, unused, url)
    }
    history.replaceState = (data, unused, url) => {
      writes.push(String(url ?? ''))
      originalReplace(data, unused, url)
    }
    Reflect.set(window, '__historyWrites', writes)
  })

  await page.locator('#ride-detail header').getByRole('button', { name: 'Zatvori', exact: true }).click()
  await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Ostaje' })).toBeHidden()

  // Let the open Ride's push finish. A later session fetch, the one that
  // would take ?ride= back off, stays held.
  await page.evaluate(() => {
    const pending = Reflect.get(window, '__sessionPending')
    if (Array.isArray(pending)) {
      const release = pending.shift()
      if (typeof release === 'function')
        release()
    }
  })
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))

  const writes = await page.evaluate(() => Reflect.get(window, '__historyWrites') as string[])
  expect(writes.filter(url => url.includes('ride='))).toEqual([])
  await expect(page).not.toHaveURL(/[?&]ride=/)

  await page.evaluate(() => {
    const pending = Reflect.get(window, '__sessionPending')
    if (!Array.isArray(pending))
      return
    while (pending.length > 0) {
      const release = pending.shift()
      if (typeof release === 'function')
        release()
    }
  })
  await page.reload()
  await hydrated(page)
  await expect(page).not.toHaveURL(/[?&]ride=/)
  await expect(page.getByRole('article').getByRole('heading', { name: 'Iva Ostaje' })).toHaveCount(0)
})
