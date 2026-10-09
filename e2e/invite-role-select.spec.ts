import { expect, test } from '@playwright/test'
import { seedTenant } from './fixtures/seed'
import { openMembers, signIn } from './fixtures/ui'

const roles = ['Administrator', 'Dispečer', 'Vozač'] as const
const viewports = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const

function expectBoxInsideViewport(
  box: { x: number, y: number, width: number, height: number },
  viewport: { width: number, height: number },
) {
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
}

for (const viewport of viewports) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    test('every invite role option is in the viewport and pointer-clickable', async ({ page }) => {
      const tenant = await seedTenant(`invite-role-click-${viewport.width}`)
      await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
      await openMembers(page)

      const region = page.getByRole('region', { name: 'Pozovi člana' })
      const select = region.getByRole('combobox', { name: 'Uloga' })
      await expect(select).toBeVisible()

      for (const role of roles) {
        await select.click()
        const option = page.getByRole('option', { name: role, exact: true })
        await expect(option).toBeVisible()
        const box = await option.boundingBox()
        expect(box, `option ${role} must have a box`).not.toBeNull()
        expectBoxInsideViewport(box!, viewport)
        await option.click()
        await expect(select).toContainText(role)
      }
    })
  })
}
