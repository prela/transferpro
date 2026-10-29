import type { Page } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { expect, test } from './fixtures/playwright'
import { seedMember, seedTenant } from './fixtures/seed'
import { hydrated, signIn, useTheme } from './fixtures/ui'

/**
 * Računi on company settings (ADR-0051). An Admin saves a token and sees
 * only the last four characters. A Dispatcher has no Računi section.
 * Phone and desktop, both themes, axe.
 */

const token = 'e2e-invoicing-token-77'

function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024
}

test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`an admin saves invoicing settings and sees only the last four characters in ${theme}`, async ({ page }) => {
      test.setTimeout(90_000)
      if (!isPhone(page))
        await page.setViewportSize({ width: 1440, height: 900 })
      const tenant = await seedTenant(`inv-set-${theme}`)
      await useTheme(page, theme)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await page.goto('/settings')
      await hydrated(page)
      const form = page.locator('#invoicing-settings-form')
      await expect(page.getByRole('heading', { name: 'Računi' })).toBeVisible()
      await form.getByLabel('Token').fill(token)
      await form.getByLabel('Rok plaćanja (dani)').fill('20')
      await form.getByLabel('Tekst stavke').fill('Airport')
      await form.getByRole('button', { name: 'Spremi', exact: true }).click()
      await expect(page.getByText('Zadnje četiri: n-77')).toBeVisible()
      await expect(form.getByLabel('Token')).toHaveValue('')
      await expect(page.getByText(token)).toHaveCount(0)
      await expect(form.getByLabel('Rok plaćanja (dani)')).toHaveValue('20')
      await expectNoAxeViolations(page)
    })
  }

  test('a dispatcher has no Računi section', async ({ page }) => {
    const tenant = await seedTenant('inv-set-disp')
    const dispatcher = await seedMember(tenant.tenantId, 'dispatcher', 'Dino')
    await signIn(page, dispatcher.email, dispatcher.password, tenant.name)
    await page.goto('/settings')
    await hydrated(page)
    await expect(page.getByRole('heading', { name: 'Profil', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Računi' })).toHaveCount(0)
  })
})
