import type { Page } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedMember, seedTenant } from './fixtures/seed'
import { openAudit, selectOption, signIn, switchLocale, useTheme } from './fixtures/ui'

const driverName = 'Ana Roster'
const otherDriverName = 'Marko Roster'
const plate = 'DU123AB'
const otherPlate = 'ZG111AA'
const archivedPlate = 'ARC999XX'
const phone = '+38591111222'
const farExpiry = '2099-01-01'

function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

function zagrebDate(instant = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zagreb',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant)
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days))
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function mondayOf(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const weekday = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay()
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday)
}

async function addDriver(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/drivers', {
    data: {
      name,
      kind: 'own',
      phone,
      drivingLicenceExpiresOn: farExpiry,
      transportLicenceExpiresOn: farExpiry,
    },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json() as { id: string }
  return body.id
}

async function addVehicle(page: Page, registrationPlate: string): Promise<string> {
  const response = await page.request.post('/api/vehicles', {
    data: {
      registrationPlate,
      kind: 'fixed',
      seatCount: 4,
      registrationExpiresOn: farExpiry,
      technicalInspectionExpiresOn: farExpiry,
      insuranceExpiresOn: farExpiry,
    },
  })
  expect(response.ok()).toBeTruthy()
  const body = await response.json() as { id: string }
  return body.id
}

async function setRoster(page: Page, rosterDate: string, driverId: string, vehicleId: string) {
  const response = await page.request.put('/api/roster', {
    data: { rosterDate, driverId, vehicleId },
  })
  expect(response.ok()).toBeTruthy()
}

function vehicleCombobox(page: Page, name: string, date: string) {
  if (isPhone(page)) {
    return page.getByRole('combobox', { name: `Vozilo za ${name}` })
      .or(page.getByRole('combobox', { name: `Vehicle for ${name}` }))
  }
  return page.getByRole('combobox', { name: `Vozilo za ${name} za ${date}` })
    .or(page.getByRole('combobox', { name: `Vehicle for ${name} on ${date}` }))
}

async function chooseVehicle(
  page: Page,
  name: string,
  registrationPlate: string,
  date: string,
  expectPlate = true,
) {
  const combobox = vehicleCombobox(page, name, date)
  const saved = page.waitForResponse(response =>
    response.request().method() === 'PUT'
    && new URL(response.url()).pathname === '/api/roster',
  )
  await selectOption(page, combobox, registrationPlate, false)
  await saved
  if (expectPlate)
    await expect(combobox).toContainText(registrationPlate)
}

test('admin gives a driver a vehicle for the day, and the audit log keeps the plate and the name off the row', async ({ page }) => {
  const tenant = await seedTenant('roster-admin')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await addDriver(page, driverName)
  await addDriver(page, otherDriverName)
  await addVehicle(page, plate)
  await addVehicle(page, otherPlate)
  const today = zagrebDate()

  await page.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: driverName }).or(page.getByRole('rowheader', { name: driverName })),
  ).toBeVisible()
  await expect(page.getByText(phone)).toHaveCount(0)

  await chooseVehicle(page, driverName, plate, today)
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' }).first()).toBeVisible()

  await page.reload()
  await expect(vehicleCombobox(page, driverName, today)).toContainText(plate)

  await chooseVehicle(page, otherDriverName, plate, today, false)
  await expect(page.getByRole('alert')).toContainText('To vozilo je već dano drugom vozaču za taj dan.')

  await chooseVehicle(page, driverName, otherPlate, today)
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' }).first()).toBeVisible()

  await chooseVehicle(page, otherDriverName, plate, today)
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' }).first()).toBeVisible()

  const clearName = isPhone(page)
    ? `Ukloni vozilo za ${driverName}`
    : `Ukloni vozilo za ${driverName} za ${today}`
  const cleared = page.waitForResponse(response =>
    response.request().method() === 'PUT'
    && new URL(response.url()).pathname === '/api/roster'
    && response.ok(),
  )
  await page.getByRole('button', { name: clearName }).click()
  await cleared
  await expect(page.getByRole('button', { name: clearName })).toHaveCount(0)

  await switchLocale(page, 'en')
  await expect(page.getByRole('heading', { level: 1, name: 'Vehicle roster' })).toBeVisible()
  await expect(vehicleCombobox(page, otherDriverName, today)).toContainText(plate)
  if (isPhone(page)) {
    await expect(page.getByText('Today', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Clear vehicle for ${otherDriverName}` })).toBeVisible()
  }
  else {
    await expect(page.getByText('This week', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: `Clear vehicle for ${otherDriverName} on ${today}` })).toBeVisible()
  }

  await switchLocale(page, 'hr')
  await openAudit(page)
  await expect(page.getByRole('cell', { name: 'Vozilo dodijeljeno za dan', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vozilo za dan promijenjeno', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Vozilo za dan uklonjeno', exact: true })).toBeVisible()
  await expect(page.getByText(plate)).toHaveCount(0)
  await expect(page.getByText(otherPlate)).toHaveCount(0)
  await expect(page.getByText(driverName)).toHaveCount(0)
  await expect(page.getByText(otherDriverName)).toHaveCount(0)
  await expect(page.getByText(phone)).toHaveCount(0)
})

test('dispatcher gives a driver a vehicle for the day', async ({ page }) => {
  const tenant = await seedTenant('roster-disp')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await addDriver(page, driverName)
  await addVehicle(page, plate)
  const today = zagrebDate()

  await page.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByRole('button', { name: tenant.name, exact: true })).toBeVisible()
  await chooseVehicle(page, driverName, plate, today)
  await expect(page.getByRole('status').filter({ hasText: 'Spremljeno.' }).first()).toBeVisible()
  await page.reload()
  await expect(vehicleCombobox(page, driverName, today)).toContainText(plate)
})

test('copying a week fills empty cells, leaves filled ones, and lists skipped cells', async ({ page }) => {
  const tenant = await seedTenant('roster-copy')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const anaId = await addDriver(page, driverName)
  const markoId = await addDriver(page, otherDriverName)
  const vanId = await addVehicle(page, plate)
  const carId = await addVehicle(page, otherPlate)
  const oldId = await addVehicle(page, archivedPlate)

  const monday = mondayOf(zagrebDate())
  const lastMonday = addDays(monday, -7)
  const lastWednesday = addDays(lastMonday, 2)
  const thisTuesday = addDays(monday, 1)

  for (let offset = 0; offset < 7; offset++)
    await setRoster(page, addDays(lastMonday, offset), anaId, vanId)
  await setRoster(page, lastMonday, markoId, carId)
  await setRoster(page, lastWednesday, markoId, oldId)
  const archived = await page.request.post(`/api/vehicles/${oldId}/archive`)
  expect(archived.ok()).toBeTruthy()
  await setRoster(page, monday, anaId, carId)

  await page.getByRole('link', { name: 'Raspored' }).click()
  await expect(page.getByRole('button', { name: 'Kopiraj prošli tjedan' })).toBeVisible()
  await page.getByRole('button', { name: 'Kopiraj prošli tjedan' }).click()

  const summary = page.getByRole('status').filter({ hasText: 'Kopirano:' })
  await expect(summary).toContainText('Kopirano: 6.')
  await expect(summary).toContainText('Preskočeno: 2.')
  await expect(page.getByText(`${otherDriverName}, ${monday}: vozilo je već dano`)).toBeVisible()
  await expect(page.getByText(`${otherDriverName}, ${addDays(monday, 2)}: arhivirano vozilo`)).toBeVisible()

  await expect(vehicleCombobox(page, driverName, monday)).toContainText(otherPlate)
  await expect(vehicleCombobox(page, driverName, thisTuesday)).toContainText(plate)
})

test('a refused copy cell is listed as skipped', async ({ page }) => {
  const tenant = await seedTenant('roster-copy-refused')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const anaId = await addDriver(page, driverName)
  const markoId = await addDriver(page, otherDriverName)
  const vanId = await addVehicle(page, plate)
  const carId = await addVehicle(page, otherPlate)

  const monday = mondayOf(zagrebDate())
  const lastMonday = addDays(monday, -7)
  await setRoster(page, lastMonday, anaId, vanId)
  await setRoster(page, addDays(lastMonday, 1), markoId, carId)

  await page.route('**/api/roster', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.continue()
      return
    }
    const body = route.request().postDataJSON() as { rosterDate?: string, driverId?: string }
    if (body.driverId === anaId && body.rosterDate === monday) {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'roster_vehicle_taken' }),
      })
      return
    }
    await route.continue()
  })

  await page.getByRole('link', { name: 'Raspored' }).click()
  await page.getByRole('button', { name: 'Kopiraj prošli tjedan' }).click()
  const summary = page.getByRole('status').filter({ hasText: 'Kopirano:' })
  await expect(summary).toContainText('Kopirano: 1.')
  await expect(summary).toContainText('Preskočeno: 1.')
  await expect(page.getByText(`${driverName}, ${monday}: poslužitelj nije prihvatio`)).toBeVisible()
  await expect(vehicleCombobox(page, otherDriverName, addDays(monday, 1))).toContainText(otherPlate)
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`phone roster is one day with large pickers in ${theme}`, async ({ page }) => {
      const tenant = await seedTenant(`roster-phone-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await addDriver(page, driverName)
      await addVehicle(page, plate)

      await page.getByRole('link', { name: 'Raspored' }).click()
      await expect(page.getByRole('heading', { level: 1, name: 'Raspored vozila' })).toBeVisible()
      const phoneView = isPhone(page)
      if (phoneView) {
        await expect(page.getByText('Danas', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Kopiraj prošli tjedan' })).toHaveCount(0)
        const picker = page.getByRole('combobox', { name: `Vozilo za ${driverName}` })
        await expect(picker).toBeVisible()
        const box = await picker.boundingBox()
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
      }
      else {
        await expect(page.getByText('Ovaj tjedan', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Kopiraj prošli tjedan' })).toBeVisible()
      }

      await expectNoAxeViolations(page)
      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('heading', { level: 1, name: 'Vehicle roster' })).toBeVisible()
        if (phoneView)
          await expect(page.getByText('Today', { exact: true })).toBeVisible()
        else
          await expect(page.getByText('This week', { exact: true })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})
