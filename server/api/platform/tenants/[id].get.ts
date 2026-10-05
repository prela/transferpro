import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { readTenantAccount } from '../../../modules/platform'
import { platformHttpError } from '../http'

/**
 * One firm. The raw id is passed through: the module refuses a non-superadmin
 * before it decides whether the id is a uuid.
 */
export default defineEventHandler(async (event) => {
  try {
    return await readTenantAccount(toWebRequest(event).headers, getRouterParam(event, 'id') ?? '')
  }
  catch (error) {
    platformHttpError(error)
  }
})
