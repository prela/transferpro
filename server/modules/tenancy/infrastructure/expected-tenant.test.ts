import { expect, it } from 'vitest'
import { assertExpectedTenant, officeWriteClaim, TenantChangedError } from '..'
import { createClientSchema } from '../../../../shared'
import { disableOfficeClaimFixture, enableOfficeClaimFixture } from './office-claim-fixture'

const active = '00000000-0000-4000-8000-00000000000a'
const other = '00000000-0000-4000-8000-00000000000b'

it('peels the screen Tenant so a strict body still parses, and a different Tenant is refused', () => {
  const headers = new Headers({ 'x-expected-tenant-id': active })
  const office = officeWriteClaim(headers, {
    name: 'Agencija',
    kind: 'agency',
    expectedTenantId: other,
  })
  expect(office.explicit).toBe(true)
  expect(office.body).toEqual({ name: 'Agencija', kind: 'agency' })
  expect(createClientSchema.safeParse(office.body).success).toBe(true)
  expect(() => assertExpectedTenant(active, office.expectedTenantId)).toThrow(TenantChangedError)
  expect(() => assertExpectedTenant(other, office.expectedTenantId)).not.toThrow()
})

it('refuses a missing claim and an empty header', () => {
  const missing = officeWriteClaim(new Headers(), { name: 'Agencija' })
  expect(missing.explicit).toBe(false)
  expect(() => assertExpectedTenant(active, missing.expectedTenantId)).toThrow(TenantChangedError)

  const empty = officeWriteClaim(new Headers({ 'x-expected-tenant-id': '' }), { name: 'Agencija' })
  expect(empty.explicit).toBe(true)
  expect(() => assertExpectedTenant(active, empty.expectedTenantId)).toThrow(TenantChangedError)
})

it('uses the session Tenant for a missing claim only while the RLS fixture flag is on', () => {
  enableOfficeClaimFixture()
  try {
    const fixture = officeWriteClaim(new Headers(), { name: 'Agencija' })
    expect(fixture.explicit).toBe(false)
    expect(() => assertExpectedTenant(active, fixture.expectedTenantId)).not.toThrow()
    expect(() => assertExpectedTenant(other, fixture.expectedTenantId)).not.toThrow()
  }
  finally {
    disableOfficeClaimFixture()
  }
  const refused = officeWriteClaim(new Headers(), { name: 'Agencija' })
  expect(() => assertExpectedTenant(active, refused.expectedTenantId)).toThrow(TenantChangedError)
})
