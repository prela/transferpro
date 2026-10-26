import { expect, it } from 'vitest'
import { TenantChangedError } from '../../modules/tenancy'
import { officeHomeHttpError } from './http'

it('maps a stale screen Tenant on a failed-mail resend to 409 tenant_changed', () => {
  expect(() => officeHomeHttpError(new TenantChangedError())).toThrowError(expect.objectContaining({
    statusCode: 409,
    data: { code: 'tenant_changed' },
  }))
})
