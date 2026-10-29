import { defineEventHandler, toWebRequest } from 'h3'
import { invoicingSettingsSchema } from '../../shared'
import { readInvoicingSettings } from '../modules/invoicing'
import { invoicingHttpError } from './invoicing-http'

/**
 * GET /api/invoicing-settings
 * The current Tenant's invoicing settings. Admin only. The token is not in
 * the body: `tokenSet` and `tokenLastFour` are the only token facts.
 */
export default defineEventHandler(async (event) => {
  try {
    return invoicingSettingsSchema.parse(await readInvoicingSettings(toWebRequest(event).headers))
  }
  catch (error) {
    invoicingHttpError(error)
  }
})
