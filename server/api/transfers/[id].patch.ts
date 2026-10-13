import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { correctedTransferResultSchema } from '../../../shared'
import { correctTransfer } from '../../modules/transfers'
import { transferHttpError } from '../transfers/http'

/**
 * PATCH /api/transfers/:id
 * A dispatcher or an admin corrects the booking. An invalid body is 400 and
 * is parsed before a session opens. A driver is 403. No session is 401.
 * A finished Ride is 409 and the stored booking is unchanged. The audit
 * entry does not contain the guest name, the flight, the note, the tabla, or the price.
 * The current Driver is mailed changed after the booking is saved, when a
 * mailed fact changed. The body is `{ transfer, ride, workOrders }`.
 * The address is not on it. A rejected send leaves the correction.
 */
export default defineEventHandler(async (event) => {
  try {
    return correctedTransferResultSchema.parse(await correctTransfer(
      toWebRequest(event).headers,
      getRouterParam(event, 'id'),
      await readBody(event),
    ))
  }
  catch (error) {
    transferHttpError(error)
  }
})
