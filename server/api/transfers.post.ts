import { defineEventHandler, readBody, toWebRequest } from 'h3'
import { recordedTransferSchema } from '../../shared'
import { createTransfer } from '../modules/transfers'
import { transferHttpError } from './transfers/http'

/**
 * POST /api/transfers
 * A dispatcher or an admin records a Transfer and its one unassigned Ride.
 * An invalid body is 400 and is parsed before a session opens. A driver is 403.
 * No session is 401. An archived start or end is 409. The audit entry written
 * with the row does not contain the guest name, the flight, the note, the tabla, or the price.
 */
export default defineEventHandler(async (event) => {
  try {
    return recordedTransferSchema.parse(await createTransfer(toWebRequest(event).headers, await readBody(event)))
  }
  catch (error) {
    transferHttpError(error)
  }
})
