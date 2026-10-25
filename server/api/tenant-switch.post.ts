import { createError, defineEventHandler, readBody, toWebRequest } from 'h3'
import { chooseTenantBodySchema } from '../../shared'
import { switchActiveTenant, TenantAccessError } from '../modules/tenancy'

/**
 * Changes the active Tenant on this session. The profile menu calls it.
 * A body that is not a company id never calls Better Auth. The gate's
 * first choice stays on POST /api/tenant-choices.
 */
export default defineEventHandler(async (event) => {
  const body = chooseTenantBodySchema.safeParse(await readBody(event))
  if (!body.success)
    throw createError({ statusCode: 400 })
  try {
    await switchActiveTenant(toWebRequest(event).headers, body.data.tenantId)
    return { ok: true }
  }
  catch (error) {
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
