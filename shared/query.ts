import { z } from 'zod'

/** GET list query `includeArchived`. Only the strings true or false are accepted. */
export const includeArchivedQuerySchema = z.union([
  z.undefined(),
  z.literal('true'),
  z.literal('false'),
])

/** The query param was not a valid includeArchived value. */
export class QueryParamError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'QueryParamError'
  }
}

/** Absent means false. Only true includes archived rows. */
export function parseIncludeArchivedQuery(raw: unknown): boolean {
  if (raw === undefined)
    return false
  const parsed = includeArchivedQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new QueryParamError()
  return parsed.data === 'true'
}
