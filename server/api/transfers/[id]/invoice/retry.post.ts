import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { transferInvoiceSchema } from '../../../../../shared'
import { retryTransferInvoice } from '../../../../modules/transfers'
import { transferHttpError } from '../../http'

/**
 * POST /api/transfers/:id/invoice/retry
 * "Pokušaj ponovno". The same checks as an issue. The invoice id stays.
 * A driver is 403. A refusal writes nothing (ADR-0051).
 */
export default defineEventHandler(async (event) => {
  const transferId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return transferInvoiceSchema.parse(await retryTransferInvoice(toWebRequest(event).headers, transferId, body))
  }
  catch (error) {
    transferHttpError(error)
  }
})
