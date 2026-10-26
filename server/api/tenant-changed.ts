import type { H3Event } from 'h3'
import { createError, getRequestHeader, readBody } from 'h3'
import { TenantChangedError } from '../modules/tenancy'

/**
 * 409 `tenant_changed`. The code is the only extra field. The handler
 * copies it into the JSON body. Nothing was written.
 */
export function rethrowTenantChanged(error: unknown): void {
  if (error instanceof TenantChangedError)
    throw createError({ statusCode: error.statusCode, data: { code: error.code } })
}

/**
 * The screen's Tenant, when the request actually sent JSON.
 * A body-less call from a test stays body-less, so the test default applies.
 */
export async function readOfficeBody(event: H3Event): Promise<unknown> {
  const type = getRequestHeader(event, 'content-type') ?? ''
  if (!type.includes('application/json'))
    return undefined
  return readBody(event)
}
