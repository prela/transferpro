import { defineEventHandler, getRouterParam, readBody, toWebRequest } from 'h3'
import { z } from 'zod'
import { removeClientContactPerson } from '../../../../../modules/clients'
import { clientHttpError, parseClientId } from '../../../http'

const removedSchema = z.object({ id: z.uuid() })

/**
 * POST /api/clients/:id/contact-persons/:contactPersonId/remove
 * Soft-remove. The person leaves the list. The body is the version the form
 * opened with. A mismatch is 409 `stale_save` and writes nothing.
 */
export default defineEventHandler(async (event) => {
  const clientId = parseClientId(getRouterParam(event, 'id'))
  const contactPersonId = parseClientId(getRouterParam(event, 'contactPersonId'))
  try {
    return removedSchema.parse(await removeClientContactPerson(
      toWebRequest(event).headers,
      clientId,
      contactPersonId,
      await readBody(event),
    ))
  }
  catch (error) {
    clientHttpError(error)
  }
})
