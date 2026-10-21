import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { instantFromWallClock } from '../shared/date'
import { formatCalendarDate, formatInstant } from '../shared/format-instant'
import { expectNoAxeViolations } from './fixtures/axe'
import { operationalDay, pinOperationalClock } from './fixtures/operational-clock'
import { recordTransfer } from './fixtures/record-transfer'
import { seedTenant } from './fixtures/seed'
import { chooseOption, hydrated, signIn, switchLocale, switchTheme, useTheme } from './fixtures/ui'

/**
 * Partner unavailability on the detail, the board warning, and the handoff
 * confirmation (ADR-0034, issue #412). Partners are not on the roster, so
 * the week grid is unchanged. The phone project does not run this file.
 */
const zone = 'Europe/Zagreb'
const partnerName = 'Mora Transfer'
const coveredGuest = 'Iva Predana'
const laterGuest = 'Nika Slobodna'

test.beforeEach(async ({ page }) => {
  await pinOperationalClock(page)
})

async function createdId(page: Page, path: string, data: unknown): Promise<string> {
  const response = await page.request.post(path, { data })
  if (!response.ok())
    throw new Error(`${response.status()} ${await response.text()}`)
  const body = await response.json() as { id: string }
  return body.id
}

async function recordTodayRide(page: Page, guest: string, wall: string): Promise<{ rideId: string, day: string }> {
  const clientId = await createdId(page, '/api/clients', { name: `Klijent ${guest}`, kind: 'agency' })
  const startLocationId = await createdId(page, '/api/locations', { name: `Polazak ${guest}`, kind: 'airport' })
  const endLocationId = await createdId(page, '/api/locations', { name: `Dolazak ${guest}`, kind: 'hotel' })
  const day = operationalDay(page)
  const recorded = await recordTransfer(page.request, {
    data: {
      clientId,
      pickupAt: instantFromWallClock(`${day}T${wall}`, zone).toISOString(),
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

async function openRide(page: Page, day: string, rideId: string, guest: string) {
  await page.goto(`/transfers?day=${day}&ride=${rideId}`)
  await hydrated(page)
  await expect(page.locator('#ride-detail').getByRole('heading', { name: guest })).toBeVisible()
}

async function handOff(page: Page, partner: string) {
  const detail = page.locator('#ride-detail')
  await detail.getByRole('button', { name: 'Više', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Predaj podizvođaču', exact: true }).click()
  await expect(detail.getByRole('heading', { name: 'Predaj podizvođaču' })).toBeVisible()
  await chooseOption(page, detail.getByRole('combobox', { name: 'Podizvođač' }), partner)
  await detail.getByRole('button', { name: 'Predaj vožnju', exact: true }).click()
}

test('the office records a Partner window, sees Nedostupan on the warning tier, and confirms a handoff', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 800 })
  const tenant = await seedTenant('partner-unavailability-hr')
  await useTheme(page, 'light')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await createdId(page, '/api/partners', { name: partnerName })
  const covered = await recordTodayRide(page, coveredGuest, '12:00')
  const later = await recordTodayRide(page, laterGuest, '15:00')

  await openRide(page, covered.day, covered.rideId, coveredGuest)
  await handOff(page, partnerName)
  await expect(page.getByRole('status').filter({ hasText: 'Predano podizvođaču' })).toBeVisible()

  await page.goto('/partners')
  await hydrated(page)
  await page.getByRole('button', { name: partnerName, exact: true }).click()
  const panel = page.getByRole('dialog')
  await panel.getByRole('tab', { name: 'Nedostupnost' }).click()
  const section = panel.getByRole('region', { name: 'Nedostupnost' })
  await expect(section).toContainText('Nema zabilježene nedostupnosti.')
  await expect(section.getByRole('checkbox', { name: 'Cijeli dani' })).toBeChecked()
  await section.getByLabel('Prvi dan', { exact: true }).fill(covered.day)
  await section.getByLabel('Zadnji dan', { exact: true }).fill(covered.day)
  await section.getByRole('button', { name: 'Dodaj nedostupnost', exact: true }).click()
  const coveredNotice = section.getByRole('status').filter({ hasText: 'Ova nedostupnost pokriva vožnje' })
  await expect(coveredNotice).toContainText(formatInstant(instantFromWallClock(`${covered.day}T12:00`, zone), zone, 'hr'))
  await expect(section.getByRole('list', { name: 'Zabilježena nedostupnost' })).toContainText(formatCalendarDate(covered.day, 'hr'))
  await expectNoAxeViolations(page)
  await panel.getByRole('button', { name: 'Odustani', exact: true }).click()
  await expect(panel).toBeHidden()

  await page.goto(`/transfers?day=${covered.day}`)
  await hydrated(page)
  const coveredRow = page.getByRole('row').filter({ hasText: coveredGuest })
  await expect(coveredRow).toContainText('Nedostupan')
  await page.getByRole('button', { name: /^Upozorenja \(\d+\)$/ }).click()
  await expect(coveredRow).toContainText('Nedostupan')
  await expect(page.getByRole('row').filter({ hasText: laterGuest })).toHaveCount(0)

  await page.goto('/roster')
  await hydrated(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
  await expect(page.getByText(partnerName)).toHaveCount(0)

  await openRide(page, later.day, later.rideId, laterGuest)
  await handOff(page, partnerName)
  const confirm = page.getByRole('dialog', { name: 'Ovaj vozač, vozilo ili podizvođač je tada nedostupan' })
  await expect(confirm).toContainText('ova potvrda vrijedi za oboje')
  await expectNoAxeViolations(page)
  await confirm.getByRole('button', { name: 'Nastavi svejedno', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Predano podizvođaču' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: laterGuest })).toContainText('Nedostupan')

  await switchTheme(page, 'dark')
  await switchLocale(page, 'en')
  await page.goto('/partners')
  await hydrated(page)
  await page.getByRole('button', { name: partnerName, exact: true }).click()
  const english = page.getByRole('dialog')
  await english.getByRole('tab', { name: 'Unavailability' }).click()
  const englishSection = english.getByRole('region', { name: 'Unavailability' })
  await expect(englishSection.getByRole('checkbox', { name: 'Whole days' })).toBeChecked()
  await expect(englishSection.getByRole('list', { name: 'Recorded unavailability' })).toContainText(formatCalendarDate(covered.day, 'en'))
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expectNoAxeViolations(page)
})
