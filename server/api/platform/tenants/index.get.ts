import { defineEventHandler, getQuery, toWebRequest } from 'h3'
import { listTenantAccounts } from '../../../modules/platform'
import { platformHttpError } from '../http'

/**
 * One page of firms, by name then slug. Metadata only.
 * `q` searches the name and the slug. The query is not logged.
 */
export default defineEventHandler(async (event) => {
  try {
    return await listTenantAccounts(toWebRequest(event).headers, getQuery(event))
  }
  catch (error) {
    platformHttpError(error)
  }
})
