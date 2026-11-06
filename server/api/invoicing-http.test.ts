import { expect, it } from 'vitest'
import { handleLoggedError } from '../core/index'
import { captureLogs } from '../core/testing'
import { InvoicingKeyMissingError } from '../modules/invoicing'
import { invoicingHttpError } from './invoicing-http'

/**
 * A missing encryption key is 409, not 500. The body keeps the fixed
 * status phrase. The screen reads `code` and shows the Croatian sentence.
 * The key and the token are not on the body.
 */

it('maps a missing invoicing key to 409 invoicing_not_configured', () => {
  let thrown: unknown
  try {
    invoicingHttpError(new InvoicingKeyMissingError())
  }
  catch (error) {
    thrown = error
  }
  const logs = captureLogs()
  const body = handleLoggedError(logs.logger, thrown, 'req-1')
  expect(body).toEqual({
    statusCode: 409,
    message: 'Request failed',
    request_id: 'req-1',
    code: 'invoicing_not_configured',
  })
  expect(JSON.stringify(body)).not.toContain('secret')
})
