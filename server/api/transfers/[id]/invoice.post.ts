import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { transferInvoiceSchema } from '../../../../shared'
import { issueTransferInvoice } from '../../../modules/transfers'
import { transferHttpError } from '../http'

/**
 * POST /api/transfers/:id/invoice
 * Office only. A driver is 403. A Transfer that cannot be invoiced is 409
 * and writes nothing. A repeat returns the invoice already stored.
 * The body is empty. The response is the state the screen shows, never the
 * line, the amount, or the buyer (ADR-0051, ADR-0053).
 */
export default defineEventHandler(async (event) => {
  const transferId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return transferInvoiceSchema.parse(await issueTransferInvoice(toWebRequest(event).headers, transferId, body))
  }
  catch (error) {
    transferHttpError(error)
  }
})
