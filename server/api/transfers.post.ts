import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { recordedCreateSchema } from '../../shared'
import { createTransfer } from '../modules/transfers'
import { transferHttpError } from './transfers/http'

/**
 * POST /api/transfers
 * A dispatcher or an admin records a Transfer and its one unassigned Ride.
 * An invalid body is 400 and is parsed before a session opens. A driver is 403
 * before any lookup. No session is 401. An archived start or end is 409.
 * A repeated manual external id is 200 with `alreadyRecorded: true` and writes
 * nothing. A new Transfer is 200 with `alreadyRecorded: false`. The audit entry
 * written with a new row does not contain the guest name, the flight, the note,
 * the tabla, the price, the channel, or the external id. Neither column is returned.
 */
export default defineEventHandler(async (event) => {
  try {
    return recordedCreateSchema.parse(await createTransfer(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    transferHttpError(error)
  }
})
