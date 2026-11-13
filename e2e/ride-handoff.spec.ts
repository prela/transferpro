import type { Page } from '@playwright/test'
import { instantFromWallClock } from '../shared/date'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Hand a Ride to a Partner from the detail (issue #410).
 * The phone project runs this block. The desktop project runs it too.
 */

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

async function recordTodayRide(page: Page, guest: string): Promise<{ rideId: string, day: string }> {
  const clientId = await createdId(page, '/api/clients', { name: `Klijent ${guest}`, kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: `Polazak ${guest}`, kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: `Dolazak ${guest}`, kind: 'hotel' })
  const day = operationalDay(page)
  const pickupAt = instantFromWallClock(`${day}T12:00`, 'Europe/Zagreb').toISOString()
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt,
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
  if (!recorded.ok())
    throw new Error(`${recorded.status()} ${await recorded.text()}`)
  const body = await recorded.json() as { ride: { id: string } }
  return { rideId: body.ride.id, day }
}

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

function rideRow(page: Page, guest: string) {
  if (isPhone(page))
    return page.getByRole('listitem').filter({ hasText: guest })
  return page.getByRole('row', { name: guest })
}

async function openRide(page: Page, day: string, rideId: string, guest: string) {
  await page.goto(`/transfers?day=${day}&ride=${rideId}`)
  await hydrated(page)
  await expect(page.locator('#ride-detail').getByRole('heading', { name: guest })).toBeVisible()
}

async function pickPartner(page: Page, name: string) {
  const detail = page.locator('#ride-detail')
  if (isPhone(page)) {
    await detail.getByRole('button', { name, exact: true }).click()
    return
  }
  await chooseOption(page, detail.getByRole('combobox', { name: 'Podizvođač' }), name)
}

async function handOff(page: Page, partner: string) {
  const detail = page.locator('#ride-detail')
  await detail.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true }).click()
  await expect(detail.getByRole('heading', { name: 'Predaj podizvođaču' })).toBeVisible()
  await pickPartner(page, partner)
  await detail.getByRole('button', { name: 'Predaj vožnju', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Predano podizvođaču' })).toBeVisible()
}

async function balanceAddsUp(page: Page, guest: string) {
  await page.goto('/')
  await hydrated(page)
  const counts = page.getByRole('region', { name: 'Brojevi za operativni dan' })
  await expect(counts).toBeVisible()
  const parts = [
    'Nedodijeljeno',
    'Čeka prihvat',
    'Dodijeljeno, nije krenulo',
    'U tijeku',
    'Predano podizvođaču',
    'Obavljeno',
    'Nedolazak',
    'Otkazano',
  ]
  const rides = await countValue(counts, 'Vožnje')
  let sum = 0
  for (const label of parts)
    sum += await countValue(counts, label)
  expect(sum).toBe(rides)
  expect(await countValue(counts, 'Predano podizvođaču')).toBe(1)
  await counts.getByRole('link', { name: /^Predano podizvođaču \d+$/ }).click()
  await expect(page).toHaveURL(/filter=handedOff/)
  await expect(rideRow(page, guest)).toContainText(guest)
}

async function countValue(region: ReturnType<Page['getByRole']>, label: string): Promise<number> {
  const link = region.getByRole('link', { name: new RegExp(`^${label} \\d+$`) })
  const text = await link.getAttribute('aria-label')
  const match = text?.match(/(\d+)$/)
  return Number(match?.[1] ?? 'NaN')
}

test.describe('@phone', () => {
  // Noon pickup is already past, so done stays the primary action (ADR-0062).
  test.beforeEach(async ({ page }) => {
    await pinOperationalClock(page, instantFromWallClock('2026-11-13T15:00', 'Europe/Zagreb'))
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`hands a ride to a partner, changes it, takes it back, and closes it in ${theme}`, async ({ page }) => {
      test.setTimeout(180_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`handoff-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      const guest = 'Iva Predaja'
      const first = 'Mora Transfer'
      const second = 'Jadran Prijevoz'
      await createdId(page, '/api/partners', { name: first })
      await createdId(page, '/api/partners', { name: second })
      const { rideId, day } = await recordTodayRide(page, guest)

      await openRide(page, day, rideId, guest)
      const detail = page.locator('#ride-detail')
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true }).click()
      await expect(detail.getByRole('heading', { name: 'Predaj podizvođaču' })).toBeVisible()
      await expect(detail.getByText('Predaja uklanja vozača i vozilo.')).toHaveCount(0)
      await expectNoAxeViolations(page)
      await pickPartner(page, first)
      await detail.getByRole('button', { name: 'Predaj vožnju', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Predano podizvođaču' })).toBeVisible()
      await expect(rideRow(page, guest)).toContainText(first)
      // The state column now says the handoff is waiting, not the stored state word.
      await expect(rideRow(page, guest)).toContainText('Čeka potvrdu podizvođača')

      await balanceAddsUp(page, guest)

      await openRide(page, day, rideId, guest)
      await expect(detail.getByText(first)).toBeVisible()
      await expect(detail.getByText('Nedodijeljeno')).toHaveCount(0)
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Promijeni podizvođača', exact: true }).click()
      await expect(detail.getByRole('heading', { name: 'Promjena podizvođača' })).toBeVisible()
      await pickPartner(page, second)
      await detail.getByRole('button', { name: 'Promijeni podizvođača', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Podizvođač promijenjen' })).toBeVisible()
      await expect(rideRow(page, guest)).toContainText(second)
      await expect(rideRow(page, guest)).not.toContainText(first)

      if (theme === 'light') {
        await openRide(page, day, rideId, guest)
        await switchLocale(page, 'en')
        await expect(detail.getByText('Awaiting subcontractor').first()).toBeVisible()
        await detail.getByRole('button', { name: 'More', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: 'Change subcontractor', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
        await switchLocale(page, 'hr')
        await detail.getByRole('button', { name: 'Više', exact: true }).click()
        await expect(page.getByRole('menuitem', { name: 'Promijeni podizvođača', exact: true })).toBeVisible()
        await page.keyboard.press('Escape')
      }

      await openRide(page, day, rideId, guest)
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Vrati vožnju', exact: true }).click()
      const takeBack = page.getByRole('dialog', { name: 'Vraćanje vožnje' })
      await takeBack.getByRole('button', { name: 'Vrati vožnju', exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: 'Vožnja vraćena' })).toBeVisible()
      await expect(rideRow(page, guest)).toContainText('Nedodijeljeno')
      await expect(rideRow(page, guest)).not.toContainText(second)

      await openRide(page, day, rideId, guest)
      await handOff(page, first)
      await openRide(page, day, rideId, guest)
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Označi nedolazak', exact: true })).toBeVisible()
      await expect(page.getByRole('menuitem', { name: 'Otkaži vožnju', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await detail.getByRole('button', { name: 'Obavljeno', exact: true }).click()
      const done = page.getByRole('dialog', { name: 'Označi vožnju obavljenom' })
      await done.getByRole('button', { name: 'Označi obavljenom', exact: true }).click()
      await expect(rideRow(page, guest)).toContainText('Obavljeno')
      await openRide(page, day, rideId, guest)
      await expect(detail.getByText('Obavljeno').first()).toBeVisible()
      await detail.getByRole('button', { name: 'Više', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true })).toHaveCount(0)
      await expect(page.getByRole('menuitem', { name: 'Promijeni podizvođača', exact: true })).toHaveCount(0)
    })
  }
})

const licence = '2031-01-01'

test('handing off an assigned ride says the driver and vehicle are cleared', async ({ page }) => {
  test.setTimeout(120_000)
  await pinOperationalClock(page, instantFromWallClock('2026-11-13T15:00', 'Europe/Zagreb'))
  await page.setViewportSize({ width: 1440, height: 900 })
  const tenant = await seedTenant('handoff-clears-crew')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const guest = 'Iva Dodjela'
  await createdId(page, '/api/partners', { name: 'Mora Transfer' })
  const driverId = await createdId(page, '/api/drivers', {
    name: 'Ana Posada',
    kind: 'own',
    phone: '+385911410410',
    drivingLicenceExpiresOn: licence,
    transportLicenceExpiresOn: licence,
  })
  const vehicleId = await createdId(page, '/api/vehicles', {
    registrationPlate: 'DU410AA',
    kind: 'fixed',
    seatCount: 4,
    registrationExpiresOn: licence,
    technicalInspectionExpiresOn: licence,
    insuranceExpiresOn: licence,
  })
  const { rideId, day } = await recordTodayRide(page, guest)
  const assigned = await page.request.post(`/api/rides/${rideId}/assign`, {
    data: { version: 0, driverId, vehicleId },
  })
  expect(assigned.ok()).toBeTruthy()

  await openRide(page, day, rideId, guest)
  const detail = page.locator('#ride-detail')
  await detail.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true }).click()
  await expect(detail.getByText('Predaja uklanja vozača i vozilo.')).toBeVisible()

  await switchLocale(page, 'en')
  await openRide(page, day, rideId, guest)
  await detail.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Hand off to a subcontractor', exact: true }).click()
  await expect(detail.getByText('Handing off clears the driver and the vehicle.')).toBeVisible()
})

const confirmationCopy = {
  hr: {
    record: 'Zabilježi potvrdu podizvođača',
    body: 'Ovo bilježi da je podizvođač potvrdio vožnju telefonom ili porukom.',
    submit: 'Zabilježi potvrdu',
    recorded: 'Podizvođač potvrdio',
    done: 'Obavljeno',
    more: 'Više',
    gone: 'Ova vožnja više ne čeka potvrdu podizvođača.',
  },
  en: {
    record: 'Record subcontractor confirmation',
    body: 'This records that the subcontractor confirmed the ride by phone or message.',
    submit: 'Record confirmation',
    recorded: 'Subcontractor confirmed',
    done: 'Done',
    more: 'More',
    gone: 'This ride is no longer waiting on the subcontractor\'s confirmation.',
  },
} as const

test.describe('@phone', () => {
  // Pickup is noon. Morning keeps the confirmation primary; afternoon moves done up (ADR-0062).
  test.beforeEach(async ({ page }) => {
    await pinOperationalClock(page, instantFromWallClock('2026-11-13T09:00', 'Europe/Zagreb'))
  })

  for (const { theme, locale } of [
    { theme: 'light', locale: 'hr' },
    { theme: 'dark', locale: 'en' },
  ] as const) {
    test(`records a subcontractor confirmation from the detail in ${theme} ${locale}`, async ({ page }) => {
      test.setTimeout(180_000)
      const phone = isPhone(page)
      if (!phone)
        await page.setViewportSize({ width: 1440, height: 900 })
      const copy = confirmationCopy[locale]
      const tenant = await seedTenant(`pconf-${theme}-${locale}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      if (locale === 'en')
        await switchLocale(page, 'en')
      const partnerId = await createdId(page, '/api/partners', { name: 'Mora Transfer' })
      const recorded = await recordTodayRide(page, 'Ana Potvrda')
      const later = await recordTodayRide(page, 'Ivo Kasnije')
      for (const rideId of [recorded.rideId, later.rideId]) {
        const handed = await page.request.post(`/api/rides/${rideId}/hand-off`, {
          data: { partnerId, version: 0 },
        })
        if (!handed.ok())
          throw new Error(`${handed.status()} ${await handed.text()}`)
      }

      await openRide(page, recorded.day, recorded.rideId, 'Ana Potvrda')
      const detail = page.locator('#ride-detail')
      await detail.getByRole('button', { name: copy.record, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: copy.record })
      await expect(dialog.getByText(copy.body)).toBeVisible()
      await expectNoAxeViolations(page)
      await dialog.getByRole('button', { name: copy.submit, exact: true }).click()
      await expect(page.getByRole('status').filter({ hasText: copy.recorded })).toBeVisible()
      await expect(rideRow(page, 'Ana Potvrda')).toContainText(copy.recorded)

      await page.clock.setSystemTime(instantFromWallClock('2026-11-13T15:00', 'Europe/Zagreb'))
      await openRide(page, later.day, later.rideId, 'Ivo Kasnije')
      await expect(detail.getByRole('button', { name: copy.done, exact: true })).toBeVisible()
      await detail.getByRole('button', { name: copy.more, exact: true }).click()
      await page.getByRole('menuitem', { name: copy.record, exact: true }).click()
      await expect(dialog.getByText(copy.body)).toBeVisible()
      const closed = await page.request.post(`/api/rides/${later.rideId}/done`, { data: {} })
      if (!closed.ok())
        throw new Error(`${closed.status()} ${await closed.text()}`)
      await dialog.getByRole('button', { name: copy.submit, exact: true }).click()
      await expect(dialog.getByRole('alert')).toContainText(copy.gone)
    })
  }
})
