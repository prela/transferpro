import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { clientNoteSchema } from '../../../../shared'
import { readClientNote } from '../../../modules/clients'
import { clientHttpError, parseClientId } from '../http'

/**
 * GET /api/clients/:id/note
 * This Client's standing note. No row is an empty note.
 * A driver is 403. No session is 401. Another Tenant's Client is 404.
 * The role check lives in the loader this handler calls.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  try {
    return clientNoteSchema.parse(await readClientNote(toWebRequest(event).headers, clientId))
  }
  catch (error) {
    clientHttpError(error)
  }
})
