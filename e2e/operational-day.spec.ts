import { expect, test } from '@playwright/test'
import { calendarDateInTimeZone, operationalDateInTimeZone } from '../shared/date'
import { seedMember, seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

test('the board opens on the operational day and the pickup form stays on the calendar date', async ({ page }) => {
  const tenant = await seedTenant('opday')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  const now = new Date()
  const operational = operationalDateInTimeZone('Europe/Zagreb', now)
  const calendar = calendarDateInTimeZone('Europe/Zagreb', now)

  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Transferi' }).click()
  // Home's counts heading is "Brojevi za operativni dan". getByLabel('Dan')
  // is a substring, so it matches that section while this route is still
  // painting. That section is not an input, and toHaveValue then throws
  // instead of waiting for the board. The day control is the textbox.
  const day = page.getByRole('textbox', { name: 'Dan', exact: true })
  await expect(day).toHaveValue(operational)
  await expect(page.getByLabel('Vrijeme preuzimanja')).toHaveValue(`${calendar}T12:00`)
})
