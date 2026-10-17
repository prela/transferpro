import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { invite, signIn, switchLocale, useTheme } from './fixtures/ui'

/**
 * Company settings tabs and Članovi (issue #262).
 * The phone project runs the @phone block.
 */

test('old settings addresses open the new tabs', async ({ page }) => {
  const tenant = await seedTenant('settings-redirect')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  await page.goto('/settings/tenant')
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('navigation', { name: 'Postavke tvrtke' }).getByRole('link', { name: 'Operativa', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('region', { name: 'Operativa' })).toBeVisible()

  await page.goto('/settings/members')
  await expect(page).toHaveURL(/\/settings\?tab=members$/)
  await expect(page.getByRole('navigation', { name: 'Postavke tvrtke' }).getByRole('link', { name: 'Članovi', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '+ Pozovi člana', exact: true })).toBeVisible()
})

test('an admin invites in the modal, sees the pending invitation, and revokes it', async ({ page }) => {
  const tenant = await seedTenant('settings-pending')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  const email = `e2e-pending-${crypto.randomUUID()}@example.test`
  await invite(page, email, 'Dispečer')
  await expect(page.getByRole('status').filter({ hasText: 'Pozivnica je poslana.' })).toBeVisible()
  await page.keyboard.press('Escape')

  const pending = page.getByRole('region', { name: 'Pozivnice na čekanju' })
  const row = pending.getByRole('row', { name: email })
  await expect(row).toContainText('Dispečer')
  await expect(row).toContainText(/\d{2}\. \d{2}\. \d{4}\. \d{2}:\d{2}/)
  await row.getByRole('button', { name: `Povuci ${email}`, exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect(pending).toContainText('Nema pozivnica na čekanju.')
})

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`company settings follows ${theme} and passes axe`, async ({ page }) => {
      const phone = isPhone(page)
      const tenant = await seedTenant(`settings-axe-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await page.goto('/settings')
      await expect(page.getByRole('heading', { level: 1, name: 'Postavke tvrtke' })).toBeVisible()

      const airport = page.getByLabel('Čekanje na aerodromu (minute)')
      const elsewhere = page.getByLabel('Čekanje izvan aerodroma (minute)')
      await expect(airport).toBeVisible()
      const airportBox = await airport.boundingBox()
      const elsewhereBox = await elsewhere.boundingBox()
      expect(airportBox).not.toBeNull()
      expect(elsewhereBox).not.toBeNull()
      if (phone)
        expect(elsewhereBox!.y).toBeGreaterThan(airportBox!.y + 8)
      else
        expect(elsewhereBox!.x).toBeGreaterThan(airportBox!.x + 8)

      await expectNoAxeViolations(page)

      await page.getByRole('link', { name: 'Članovi', exact: true }).click()
      await expect(page.getByRole('button', { name: '+ Pozovi člana', exact: true })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Pozivnice na čekanju' })).toBeVisible()
      await expect(page.getByRole('row', { name: tenant.adminEmail })).toBeVisible()
      await expectNoAxeViolations(page)

      if (theme === 'light') {
        await switchLocale(page, 'en')
        await expect(page.getByRole('heading', { level: 1, name: 'Company settings' })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Members', exact: true })).toHaveAttribute('aria-current', 'page')
        await expect(page.getByRole('button', { name: '+ Invite a member', exact: true })).toBeVisible()
        await expect(page.getByRole('region', { name: 'Pending invitations' })).toBeVisible()
        await expectNoAxeViolations(page)
      }
    })
  }
})

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}
