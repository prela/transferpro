import { expect, test } from '@playwright/test'
import { expectNoAxeViolations } from './fixtures/axe'
import { seedTenant } from './fixtures/seed'
import { openInvite, openMembers, signIn } from './fixtures/ui'

/**
 * The invite dialog keeps Nuxt UI's scale-in. That fade washes the primary
 * button for 200ms: long enough for axe on a fast runner, gone on a slow one.
 * Stretch the enter animation in this document only, so a check that does
 * not wait still samples the fade here. The app itself is unchanged.
 */
test('axe on an opening dialog waits out the enter fade', async ({ page }) => {
  const tenant = await seedTenant('axe-dialog')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)
  await openMembers(page)
  await page.addStyleTag({
    content: `
      [data-slot="overlay"],
      [role="dialog"] {
        animation-duration: 800ms !important;
      }
    `,
  })
  const dialog = await openInvite(page)
  const primary = dialog.getByRole('button', { name: 'Pošalji pozivnicu', exact: true })
  await expect(primary).toBeVisible()
  // scale-in itself, still running: opacity 0 → 1 on the dialog. A spinner
  // elsewhere would not prove the washed primary button.
  const dialogFading = await dialog.evaluate(element =>
    element.getAnimations().some((animation) => {
      if (animation.playState !== 'running')
        return false
      const effect = animation.effect
      const getKeyframes: unknown = effect !== null && 'getKeyframes' in effect ? effect.getKeyframes : undefined
      if (typeof getKeyframes !== 'function')
        return false
      const frames = getKeyframes.call(effect) as ReadonlyArray<{ opacity?: unknown }>
      return frames.some(frame => frame.opacity != null)
    }),
  )
  expect(dialogFading).toBe(true)
  // A hovered primary button uses the /75 fill, which is below 4.5:1.
  await page.mouse.move(0, 0)
  await expectNoAxeViolations(page)
})
