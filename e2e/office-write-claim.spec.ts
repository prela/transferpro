import { expect, test } from './fixtures/playwright'
import { seedTenant } from './fixtures/seed'
import { signIn } from './fixtures/ui'

/**
 * The built server has no missing-claim hatch. A fixture write goes through
 * the Playwright helper and succeeds. The same write with neither the field
 * nor the header is 409.
 */
test('an office write without a screen Tenant is refused', async ({ page }) => {
  const tenant = await seedTenant('office-claim')
  await signIn(page, tenant.adminEmail, tenant.password, tenant.name)

  const cookies = await page.context().cookies()
  const bare = await fetch(new URL('/api/clients', page.url()), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cookie': cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
    },
    body: JSON.stringify({ name: 'Bez tvrtke', kind: 'agency' }),
  })
  expect(bare.status).toBe(409)
  expect(await bare.json()).toMatchObject({ code: 'tenant_changed' })

  const saved = await page.request.post('/api/clients', {
    data: { name: 'S tvrtkom', kind: 'agency' },
  })
  expect(saved.ok()).toBe(true)
})
