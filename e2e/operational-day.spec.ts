import { operationalDateInTimeZone, suggestedPickupWall } from '../shared/date'
import { operationalNow, pinOperationalClock } from './fixtures/operational-clock'
import { expect, test } from './fixtures/playwright'
import { seedMember, seedTenant } from './fixtures/seed'
import { openNewTransfer, signIn } from './fixtures/ui'

test.beforeEach(async ({ page }) => {
  // The board and this assertion share one instant, including at 04:55,
  // 05:00, and 05:05, when the operational day and the calendar date split.
  await pinOperationalClock(page)
})

test('the board opens on the operational day and a new Transfer suggests that day', async ({ page }) => {
  const tenant = await seedTenant('opday')
  const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dispečer')
  const now = operationalNow(page)
  const operational = operationalDateInTimeZone('Europe/Zagreb', now)

  await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
  await page.getByRole('link', { name: 'Transferi' }).click()
  // Home's counts heading is "Brojevi za operativni dan". getByLabel('Dan')
  // is a substring, so it matches that section while this route is still
  // painting. That section is not an input, and toHaveValue then throws
  // instead of waiting for the board. The day control is the textbox.
  const day = page.getByRole('textbox', { name: 'Dan', exact: true })
  await expect(day).toHaveValue(operational)
  // The pickup field lives in the record slideover. This expectation calls
  // the same function as the form, so a wrong rule would still pass here.
  // The literals are in shared/date.test.ts and e2e/pickup-suggestion.spec.ts.
  // This spec only checks that the live clock, including the 05:00 split, is wired.
  await openNewTransfer(page)
  await expect(page.getByRole('dialog').getByLabel('Vrijeme preuzimanja')).toHaveValue(
    suggestedPickupWall(operational, now, 'Europe/Zagreb'),
  )
})
