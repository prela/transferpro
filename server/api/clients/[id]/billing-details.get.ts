import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { clientBillingSchema } from '../../../../shared'
import { readClientBilling } from '../../../modules/clients'
import { clientHttpError, parseClientId } from '../http'

/**
 * GET /api/clients/:id/billing-details
 * This Client's billing details. No row is incomplete.
 * A driver is 403. No session is 401. Another Tenant's Client is 404.
 * The role check lives in the loader this handler calls.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  try {
    return clientBillingSchema.parse(await readClientBilling(toWebRequest(event).headers, clientId))
  }
  catch (error) {
    clientHttpError(error)
  }
})
