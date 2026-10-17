import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { useTheme } from './fixtures/ui'

// @phone: the phone project runs this file as well as the desktop project.
test.describe('@phone', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`the sign-in card and the invitation card follow ${theme} and pass axe`, async ({ page }) => {
      const tenant = await seedTenant(`sign-in-card-${theme}`)
      await useTheme(page, theme)
      await page.goto('/')

      await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
      await expect(page.getByText('Dispečerski sustav za transfere', { exact: true })).toBeVisible()
      await expect(page.getByLabel('E-pošta')).toBeVisible()
      await expect(page.getByLabel('Lozinka')).toBeVisible()
      const submit = page.getByRole('button', { name: 'Prijavi se', exact: true })
      await expect(submit).toBeVisible()
      await expect(page.getByRole('link', { name: 'Zaboravljena lozinka?' })).toBeVisible()
      await expect(page.getByRole('img')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'English', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Svijetla', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Tamna', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Prema uređaju', exact: true })).toBeVisible()
      if (theme === 'dark')
        await expect(page.locator('html')).toHaveClass(/dark/)
      else
        await expect(page.locator('html')).not.toHaveClass(/dark/)

      await expectCentredCard(page)
      await expectSmallPickers(page)
      await expectFullWidthSubmit(page, 'Prijavi se')
      await expectNoAxeViolations(page)

      // The choice is applied before any session exists. A later document
      // load restores the theme this test registered, so the invitation
      // check below still runs in this theme.
      await page.getByRole('button', { name: theme === 'dark' ? 'Svijetla' : 'Tamna', exact: true }).click()
      if (theme === 'dark')
        await expect(page.locator('html')).not.toHaveClass(/dark/)
      else
        await expect(page.locator('html')).toHaveClass(/dark/)
      await expect(page.getByText('Dispečerski sustav za transfere', { exact: true })).toBeVisible()

      await page.getByLabel('E-pošta').fill(tenant.adminEmail)
      await page.getByLabel('Lozinka').fill('not-the-password')
      await page.getByLabel('Lozinka').press('Enter')
      const alert = page.getByRole('alert')
      await expect(alert).toContainText('Prijava nije uspjela. Provjerite e-poštu i lozinku pa pokušajte ponovno.')
      await expectBelow(page, 'Prijavi se', alert)

      if (theme === 'light') {
        await page.getByRole('button', { name: 'English', exact: true }).click()
        await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
        await expect(page.getByText('Dispatch system for transfers', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Hrvatski', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible()
        await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible()
        await expectNoAxeViolations(page)
      }

      await page.goto('/accept-invite')
      await expect(page.getByRole('heading', { level: 1, name: 'Transferpro' })).toBeVisible()
      if (theme === 'light') {
        const english = page.getByRole('button', { name: 'English', exact: true })
        if (await english.isVisible())
          await english.click()
        await expect(page.getByRole('heading', { level: 2, name: 'Accept invite' })).toBeVisible()
        await expect(page.getByText('Dispatch system for transfers', { exact: true })).toBeVisible()
      }
      else {
        await expect(page.getByRole('heading', { level: 2, name: 'Prihvati pozivnicu' })).toBeVisible()
        await expect(page.getByText('Dispečerski sustav za transfere', { exact: true })).toBeVisible()
      }
      await expectCentredCard(page)
      await expectNoAxeViolations(page)
    })
  }
})

/** The card column is at most 28rem and sits in the middle of the frame. */
async function expectCentredCard(page: import('@playwright/test').Page) {
  const box = await page.locator('main').evaluate((el) => {
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    const rect = el.getBoundingClientRect()
    const frame = el.parentElement?.getBoundingClientRect()
    const token = getComputedStyle(document.documentElement).getPropertyValue('--tp-frame').trim()
    const probe = document.createElement('div')
    probe.style.background = token
    document.body.append(probe)
    const expected = getComputedStyle(probe).backgroundColor
    probe.remove()
    const actual = frame ? getComputedStyle(el.parentElement!).backgroundColor : ''
    return {
      rem,
      width: rect.width,
      leftGap: frame ? rect.left - frame.left : 0,
      rightGap: frame ? frame.right - rect.right : 0,
      onFrame: actual === expected,
    }
  })
  expect(box.width).toBeLessThanOrEqual(28 * box.rem + 1)
  expect(Math.abs(box.leftGap - box.rightGap)).toBeLessThan(2)
  expect(box.onFrame).toBe(true)
}

/** Language and theme stay small and in the top-right of the frame. */
async function expectSmallPickers(page: import('@playwright/test').Page) {
  const button = page.getByRole('button', { name: 'Svijetla', exact: true })
  const group = page.getByRole('group', { name: 'Tema' })
  const mark = page.getByRole('heading', { level: 1, name: 'Transferpro' })
  const buttonBox = await button.boundingBox()
  const groupBox = await group.boundingBox()
  const markBox = await mark.boundingBox()
  const viewport = page.viewportSize()
  expect(buttonBox).not.toBeNull()
  expect(groupBox).not.toBeNull()
  expect(markBox).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(buttonBox!.height).toBeLessThan(40)
  expect(groupBox!.y).toBeLessThan(markBox!.y)
  expect(groupBox!.x + groupBox!.width).toBeGreaterThan(viewport!.width - 48)
}

async function expectFullWidthSubmit(page: import('@playwright/test').Page, name: string) {
  const full = await page.getByRole('button', { name, exact: true }).evaluate((button) => {
    const form = button.closest('form')
    if (!form)
      return false
    return Math.abs(button.getBoundingClientRect().width - form.getBoundingClientRect().width) < 2
  })
  expect(full).toBe(true)
}

async function expectBelow(page: import('@playwright/test').Page, name: string, alert: ReturnType<import('@playwright/test').Page['getByRole']>) {
  const buttonBox = await page.getByRole('button', { name, exact: true }).boundingBox()
  const alertBox = await alert.boundingBox()
  expect(buttonBox).not.toBeNull()
  expect(alertBox).not.toBeNull()
  expect(alertBox!.y).toBeGreaterThan(buttonBox!.y + buttonBox!.height - 1)
}
