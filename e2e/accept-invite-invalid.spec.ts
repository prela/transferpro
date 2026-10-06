import { expect, test } from '@playwright/test'

test('an invite without an id, or with an unknown id, is refused', async ({ page }) => {
  await page.goto('/accept-invite')
  await expect(page.getByRole('heading', { level: 1, name: 'Prihvati pozivnicu' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Ova pozivnica nije valjana.')
  await expect(page.getByRole('button', { name: 'Otvori račun', exact: true })).toHaveCount(0)

  await page.goto(`/accept-invite#${crypto.randomUUID()}`)
  await expect(page.getByRole('alert')).toContainText('Ova pozivnica nije valjana.')

  await page.getByRole('button', { name: 'English', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Accept invite' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('This invite is not valid.')
})
