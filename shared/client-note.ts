import { z } from 'zod'

/**
 * One standing Client note. 2000 is a short instruction, such as how the
 * Client wants its guests met, not a call log. ADR-0049. A Partner note
 * uses the same bound.
 */
export const CLIENT_NOTE_MAX_LENGTH = 2000

/**
 * The only field name an audit row may store for a Client note.
 * The text itself is not in this list.
 */
export const CLIENT_NOTE_FIELD = 'note' as const

/** The note the card shows. Null text is a cleared note, or no row yet. */
export const clientNoteSchema = z.object({
  clientId: z.uuid(),
  note: z.string().trim().min(1).max(CLIENT_NOTE_MAX_LENGTH).nullable(),
  /**
   * Null when this Client has no note row. The first save then sends no
   * version. A row, including a cleared one, always has a version.
   */
  version: z.number().int().nonnegative().nullable(),
  changedAt: z.iso.datetime().nullable(),
  changedByName: z.string().min(1).nullable(),
}).refine(row => row.version === null
  ? row.note === null && row.changedAt === null && row.changedByName === null
  : row.changedAt !== null)

export type ClientNote = z.infer<typeof clientNoteSchema>

/**
 * PUT /api/clients/:id/note. An unknown key is refused. The first save
 * omits `version`. A later save sends the version the form opened with.
 * Blank text clears the note. ADR-0049.
 */
const clientNoteSaveSchema = z.strictObject({
  note: z.string().nullable(),
  version: z.number().int().nonnegative().optional(),
})

export interface ClientNoteSave {
  readonly note: string | null
  /** Absent on the first save. A later save sends the opened version. */
  readonly version?: number
}

/** The body was not a valid Client note. Nothing is written. The text is not in the message. */
export class ClientNoteInputError extends Error {
  readonly statusCode = 400

  constructor() {
    super('Bad request')
    this.name = 'ClientNoteInputError'
  }
}

/**
 * Accepts a note save. Any other body throws first, so the caller does not
 * open a session. Blank text is a clear. A note past 2000 characters is refused.
 */
export function parseClientNoteSave(raw: unknown): ClientNoteSave {
  const parsed = clientNoteSaveSchema.safeParse(raw)
  if (!parsed.success)
    throw new ClientNoteInputError()
  const note = clearedNote(parsed.data.note)
  return parsed.data.version === undefined ? { note } : { note, version: parsed.data.version }
}

/** Blank text clears the note. A present value has to fit the standing-note bound. */
function clearedNote(value: string | null): string | null {
  if (value === null)
    return null
  const trimmed = value.trim()
  if (trimmed === '')
    return null
  if (trimmed.length > CLIENT_NOTE_MAX_LENGTH)
    throw new ClientNoteInputError()
  return trimmed
}
