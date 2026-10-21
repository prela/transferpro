import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { clientNoteSchema } from '../../../../shared'
import { writeClientNote } from '../../../modules/clients'
import { clientHttpError, parseClientId } from '../http'

/**
 * PUT /api/clients/:id/note
 * A dispatcher or an admin saves the one Client note. An invalid body is 400
 * and is parsed before a session opens. The first save sends no version.
 * A mismatch, and a second first save, are 409 `stale_save` and write nothing.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  try {
    return clientNoteSchema.parse(await writeClientNote(toWebRequest(event).headers, clientId, await readBody(event)))
  }
  catch (error) {
    clientHttpError(error)
  }
})
