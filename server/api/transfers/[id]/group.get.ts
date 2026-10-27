import { defineEventHandler, getRouterParam, toWebRequest } from 'h3'
import { transferGroupSchema } from '../../../../shared'
import { readTransferGroup } from '../../../modules/transfers'
import { transferHttpError } from '../http'

/**
 * GET /api/transfers/:id/group
 * The group this Transfer belongs to, including members whose pickup is
 * another day. Each member carries that Transfer's own pickup. Admin and
 * dispatcher may read it. A driver is 403. No session is 401. A bad id is
 * 400 and is refused before a session opens. A missing Transfer, including
 * another Tenant's, is 404. The body is `{ members }`. An ordinary Transfer
 * is an empty list. Nothing is written and nothing is audited.
 */
export default defineEventHandler(async (event) => {
  try {
    return transferGroupSchema.parse(await readTransferGroup(
      toWebRequest(event).headers,
      getRouterParam(event, 'id'),
    ))
  }
  catch (error) {
    transferHttpError(error)
  }
})
