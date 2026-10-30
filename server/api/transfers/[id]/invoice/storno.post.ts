import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { transferInvoiceSchema } from '../../../../../shared'
import { stornoTransferInvoice } from '../../../../modules/transfers'
import { transferHttpError } from '../../http'

/**
 * POST /api/transfers/:id/invoice/storno
 * Admin only. A dispatcher or a driver is 403. A created or sent invoice
 * becomes cancelling. Any other state is 409 and writes nothing.
 * The body is empty. The number of the storno arrives with the status job.
 */
export default defineEventHandler(async (event) => {
  const transferId = getRouterParam(event, 'id')
  const body = await readBody(event)
  try {
    return transferInvoiceSchema.parse(await stornoTransferInvoice(toWebRequest(event).headers, transferId, body))
  }
  catch (error) {
    transferHttpError(error)
  }
})
