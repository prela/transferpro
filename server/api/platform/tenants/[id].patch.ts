import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { renameTenantAccount } from '../../../modules/platform'
import { platformHttpError } from '../http'

/** Rename the display name. The body is not logged. */
export default defineEventHandler(async (event) => {
  try {
    return await renameTenantAccount(
      toWebRequest(event).headers,
      getRouterParam(event, 'id') ?? '',
      await readBody(event),
    )
  }
  catch (error) {
    platformHttpError(error)
  }
})
