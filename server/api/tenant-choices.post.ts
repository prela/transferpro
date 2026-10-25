import { createError, defineEventHandler, readBody, toWebRequest } from 'h3'
import { chooseTenantBodySchema } from '../../shared'
import { chooseActiveTenant, TenantAccessError } from '../modules/tenancy'

/**
 * Sets the active Tenant on this session. A body that is not a company id
 * never calls Better Auth. A company the person cannot open is 403.
 */
export default defineEventHandler(async (event) => {
  const body = chooseTenantBodySchema.safeParse(await readBody(event))
  if (!body.success)
    throw createError({ statusCode: 400 })
  try {
    await chooseActiveTenant(toWebRequest(event).headers, body.data.tenantId)
    return { ok: true }
  }
  catch (error) {
    if (error instanceof TenantAccessError)
      throw createError({ statusCode: error.statusCode })
    throw error
  }
})
