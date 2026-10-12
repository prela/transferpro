import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { recordedTransferSchema } from '../../../shared'
import { correctTransfer } from '../../modules/transfers'
import { transferHttpError } from '../transfers/http'

/**
 * PATCH /api/transfers/:id
 * A dispatcher or an admin corrects the booking. An invalid body is 400 and
 * is parsed before a session opens. A driver is 403. No session is 401.
 * A finished Ride is 409 and the stored booking is unchanged. The audit
 * entry does not contain the guest name, the flight, the note, the tabla, or the price.
 * No mail is sent.
 */
export default defineEventHandler(async (event) => {
  try {
    return recordedTransferSchema.parse(await correctTransfer(
      toWebRequest(event).headers,
      getRouterParam(event, 'id'),
      await readBody(event),
    ))
  }
  catch (error) {
    transferHttpError(error)
  }
})
