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
  // The stretched fade is still running. The helper has to wait it out.
  const fading = await page.evaluate(() =>
    document.getAnimations().some(animation => animation.playState === 'running'),
  )
  expect(fading).toBe(true)
  await expectNoAxeViolations(page)
})
