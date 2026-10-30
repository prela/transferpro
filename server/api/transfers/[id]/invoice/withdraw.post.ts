import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { transferInvoiceSchema } from '../../../../../shared'
import { withdrawTransferInvoice } from '../../../../modules/transfers'
import { transferHttpError } from '../../http'

/**
 * POST /api/transfers/:id/invoice/withdraw
 * Admin only, on a failed invoice. A lookup by our reference runs first.
 * The tool's invoice is adopted as created. None becomes withdrawn.
 */
export default defineEventHandler(async (event) => {
  const transferId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return transferInvoiceSchema.parse(await withdrawTransferInvoice(toWebRequest(event).headers, transferId, body))
  }
  catch (error) {
    transferHttpError(error)
  }
})
