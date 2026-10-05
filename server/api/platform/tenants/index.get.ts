import { defineEventHandler, toWebRequest } from 'h3'
import { listTenantAccounts } from '../../../modules/platform'
import { platformHttpError } from '../http'

/** Every firm, by name then slug. Metadata only. */
export default defineEventHandler(async (event) => {
  try {
    return await listTenantAccounts(toWebRequest(event).headers)
  }
  catch (error) {
    platformHttpError(error)
  }
})
