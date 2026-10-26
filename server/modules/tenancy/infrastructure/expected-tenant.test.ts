import { expect, it } from 'vitest'
import { assertExpectedTenant, officeWriteClaim, TenantChangedError } from '..'
import { createClientSchema } from '../../../../shared'

const active = '00000000-0000-4000-8000-00000000000a'
const other = '00000000-0000-4000-8000-00000000000b'

it('peels the screen Tenant so a strict body still parses, and a different Tenant is refused', () => {
  const headers = new Headers({ 'x-expected-tenant-id': active })
  const office = officeWriteClaim(headers, {
    name: 'Agencija',
    kind: 'agency',
    expectedTenantId: other,
  }, 'production')
  expect(office.explicit).toBe(true)
  expect(office.body).toEqual({ name: 'Agencija', kind: 'agency' })
  expect(createClientSchema.safeParse(office.body).success).toBe(true)
  expect(() => assertExpectedTenant(active, office.expectedTenantId)).toThrow(TenantChangedError)
  expect(() => assertExpectedTenant(other, office.expectedTenantId)).not.toThrow()
})

it('refuses a missing claim in production and an empty header in tests', () => {
  const missing = officeWriteClaim(new Headers(), { name: 'Agencija' }, 'production')
  expect(missing.explicit).toBe(false)
  expect(() => assertExpectedTenant(active, missing.expectedTenantId)).toThrow(TenantChangedError)

  const empty = officeWriteClaim(new Headers({ 'x-expected-tenant-id': '' }), { name: 'Agencija' }, 'test')
  expect(empty.explicit).toBe(true)
  expect(() => assertExpectedTenant(active, empty.expectedTenantId)).toThrow(TenantChangedError)
})

it('treats a test fixture that names no Tenant as the session Tenant', () => {
  const fixture = officeWriteClaim(new Headers(), { name: 'Agencija' }, 'test')
  expect(fixture.explicit).toBe(false)
  expect(() => assertExpectedTenant(active, fixture.expectedTenantId)).not.toThrow()
  expect(() => assertExpectedTenant(other, fixture.expectedTenantId)).not.toThrow()
})
