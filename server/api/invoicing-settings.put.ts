import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { invoicingSettingsSchema } from '../../shared'
import { writeInvoicingSettings } from '../modules/invoicing'
import { invoicingHttpError } from './invoicing-http'

/**
 * PUT /api/invoicing-settings
 * An admin saves due days, the VAT rate, the line text, and an optional
 * token. A dispatcher or a driver is 403. An invalid body is 400 and is
 * parsed before a session opens. The response has no token.
 */
export default defineEventHandler(async (event) => {
  try {
    return invoicingSettingsSchema.parse(await writeInvoicingSettings(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    invoicingHttpError(error)
  }
})
