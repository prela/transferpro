import { z } from 'zod'

/**
 * An agency's legal name fits; 200 is enough for a hotel company name and
 * short enough that a pasted paragraph is a mistake, not a name.
 * Postgres `length` and this check both count characters.
 */
export const CLIENT_NAME_MAX_LENGTH = 200

/** The three kinds a Transfer can name. A Partner is not a Client. */
export const CLIENT_KINDS = ['agency', 'hotel', 'individual'] as const

export const clientKindSchema = z.enum(CLIENT_KINDS)

export type ClientKind = z.infer<typeof clientKindSchema>

/** Trimmed, required, at most {@link CLIENT_NAME_MAX_LENGTH} characters. */
export const clientNameSchema = z.string().trim().min(1).max(CLIENT_NAME_MAX_LENGTH)

export const clientSchema = z.object({
  id: z.uuid(),
  name: clientNameSchema,
  kind: clientKindSchema,
})

export type Client = z.infer<typeof clientSchema>

export const clientListSchema = z.object({
  clients: z.array(clientSchema),
})

export type ClientList = z.infer<typeof clientListSchema>

/** POST /api/clients. An unknown key is refused. */
export const createClientSchema = z.strictObject({
  name: clientNameSchema,
  kind: clientKindSchema,
})

export type CreateClient = z.infer<typeof createClientSchema>

/**
 * PATCH /api/clients/:id. A field that is absent stays as it is.
 * An unknown key is refused. An empty object changes nothing.
 */
export const clientPatchSchema = z.strictObject({
  name: clientNameSchema.optional(),
  kind: clientKindSchema.optional(),
})

export type ClientPatch = z.infer<typeof clientPatchSchema>

/** The body was not a valid Client. Nothing is written. */
export class ClientInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'ClientInputError'
  }
}

/**
 * Accepts a new Client. Any other body throws first, so the caller does
 * not open a session and does not write.
 */
export function parseCreateClient(raw: unknown): CreateClient {
  const parsed = createClientSchema.safeParse(raw)
  if (!parsed.success)
    throw new ClientInputError()
  return parsed.data
}

/** Accepts a correction. Any other body throws first. */
export function parseClientPatch(raw: unknown): ClientPatch {
  const parsed = clientPatchSchema.safeParse(raw)
  if (!parsed.success)
    throw new ClientInputError()
  return parsed.data
}

export type ClientNameError = 'empty' | 'too-long'
export type ClientKindError = 'invalid'

/**
 * What the add and edit forms can tell the person before a request.
 * The HTTP body stays a fixed phrase per status; these are the field reasons.
 */
export function clientNameError(name: string): ClientNameError | null {
  const trimmed = name.trim()
  if (trimmed.length === 0)
    return 'empty'
  if (trimmed.length > CLIENT_NAME_MAX_LENGTH)
    return 'too-long'
  return null
}

export function clientKindError(kind: string): ClientKindError | null {
  return clientKindSchema.safeParse(kind).success ? null : 'invalid'
}
