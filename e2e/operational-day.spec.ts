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
  await expect(page.getByLabel('Dan')).toHaveValue(operational)
  await expect(page.getByLabel('Vrijeme preuzimanja')).toHaveValue(`${calendar}T12:00`)
})
