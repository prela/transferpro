import { z } from 'zod'
import { paymentMethodSchema } from './transfer'

/**
 * An unfinished new Transfer stays in the browser (ADR-0038). The storage
 * key is the user and the Tenant, so the next person on a shared computer
 * does not read it. It expires 24 hours after it was written. Save, discard,
 * and sign-out remove it. The booking fields stay in the browser. The entry
 * key is the exception: the form sends that one id on create (ADR-0035).
 */
export const TRANSFER_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

/** How a Transfer form was opened. A correction has no entry key. An extra vehicle is a new entry. */
export type TransferEntryOpening = 'blank' | 'duplicate' | 'return' | 'extra' | 'correction'

/**
 * A blank form, a duplicate, and a return journey each start a new entry,
 * so each gets a new id. A correction changes a Transfer that already has
 * one, and its body refuses a key. `random` is `crypto.randomUUID` in the
 * browser. Tests pass a fixed sequence.
 */
export function transferEntryKey(
  opening: TransferEntryOpening,
  random: () => string = () => crypto.randomUUID(),
): string | null {
  if (opening === 'correction')
    return null
  return random()
}

/** One entry per user and Tenant. A different pair is a different key. */
export function transferDraftKey(userId: string, tenantId: string): string {
  return `transferpro-transfer-draft:${userId}:${tenantId}`
}

const transferDraftFieldsSchema = z.object({
  clientId: z.uuid().nullable(),
  pickupWall: z.string(),
  startLocationId: z.uuid().nullable(),
  endLocationId: z.uuid().nullable(),
  passengers: z.string(),
  guest: z.string(),
  price: z.string(),
  payment: paymentMethodSchema.nullable(),
  flight: z.string(),
  airportMark: z.boolean(),
  tabla: z.string(),
  // Missing on a draft written before the column existed. A blank is still a blank.
  clientReference: z.string().optional().transform(value => value ?? ''),
  luggage: z.string(),
  childSeats: z.string(),
  note: z.string(),
  // An extra vehicle keeps its main Transfer on the draft, so a reload
  // does not record a Price of 0 with no link (ADR-0054). Absent on an
  // ordinary Transfer. `groupPassengers` is present only while the form
  // still asks for the group's ordered count.
  mainTransferId: z.uuid().optional(),
  mainVersion: z.number().int().nonnegative().optional(),
  groupPassengers: z.string().optional(),
  // The manual channel's external id (ADR-0035). Absent on a draft written
  // before the form started keeping one. A blank form is still blank: the
  // id alone is not unfinished work, so a reload of an empty form mints another.
  externalId: z.uuid().optional(),
}).strict()

const transferDraftSchema = transferDraftFieldsSchema.extend({
  savedAt: z.iso.datetime(),
  userId: z.string().min(1),
  tenantId: z.uuid(),
}).strict()

export type TransferDraftFields = z.infer<typeof transferDraftFieldsSchema>
export type TransferDraft = z.infer<typeof transferDraftSchema>

/** The subset the form reads. `localStorage` satisfies it. */
export interface TransferDraftStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export type TransferDraftEvent = 'save' | 'discard' | 'sign-out' | 'edit' | 'already-recorded'

/**
 * A new Transfer with only the blank defaults is not unfinished work.
 * The pickup clock is filled as soon as the form opens, so it counts only
 * when it differs from that opened value. `openedPickup` is that value.
 */
export function transferDraftIsBlank(fields: TransferDraftFields, openedPickup?: string): boolean {
  if (openedPickup !== undefined && fields.pickupWall !== openedPickup)
    return false
  return fields.clientId === null
    && fields.startLocationId === null
    && fields.endLocationId === null
    && fields.payment === null
    && fields.guest.trim() === ''
    && fields.price.trim() === ''
    && fields.flight.trim() === ''
    && fields.tabla.trim() === ''
    && fields.clientReference.trim() === ''
    && fields.note.trim() === ''
    && !fields.airportMark
    && (fields.passengers.trim() === '' || fields.passengers.trim() === '1')
    && (fields.luggage.trim() === '' || fields.luggage.trim() === '0')
    && (fields.childSeats.trim() === '' || fields.childSeats.trim() === '0')
}

/**
 * Više stays collapsed until a correction (or a restored draft) has one of
 * these. Zero luggage and zero child seats are the blank default, not a value.
 * The airport mark counts only when it was chosen.
 */
export function transferMoreHasValue(fields: Pick<TransferDraftFields, 'flight' | 'airportMark' | 'tabla' | 'luggage' | 'childSeats' | 'note'>): boolean {
  return fields.flight.trim() !== ''
    || fields.airportMark
    || fields.tabla.trim() !== ''
    || (fields.luggage.trim() !== '' && fields.luggage.trim() !== '0')
    || (fields.childSeats.trim() !== '' && fields.childSeats.trim() !== '0')
    || fields.note.trim() !== ''
}

/** Writes the draft, or removes the key when the form is still blank. */
export function rememberTransferDraft(
  store: TransferDraftStore,
  userId: string,
  tenantId: string,
  fields: TransferDraftFields,
  now: Date,
  openedPickup?: string,
): void {
  const key = transferDraftKey(userId, tenantId)
  if (transferDraftIsBlank(fields, openedPickup)) {
    store.removeItem(key)
    return
  }
  const draft = transferDraftSchema.parse({
    ...fields,
    savedAt: now.toISOString(),
    userId,
    tenantId,
  })
  store.setItem(key, JSON.stringify(draft))
}

/**
 * The draft for this user and Tenant, or null. An expired, unreadable, or
 * foreign payload under this key is removed. Another user's key is left alone.
 */
export function recallTransferDraft(store: TransferDraftStore, userId: string, tenantId: string, now: Date): TransferDraft | null {
  const key = transferDraftKey(userId, tenantId)
  const raw = store.getItem(key)
  if (raw === null)
    return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  }
  catch {
    store.removeItem(key)
    return null
  }
  const draft = transferDraftSchema.safeParse(parsed)
  if (!draft.success || draft.data.userId !== userId || draft.data.tenantId !== tenantId) {
    store.removeItem(key)
    return null
  }
  const age = now.getTime() - Date.parse(draft.data.savedAt)
  if (Number.isNaN(age) || age >= TRANSFER_DRAFT_TTL_MS) {
    store.removeItem(key)
    return null
  }
  return draft.data
}

/**
 * Save, discard, and sign-out remove the draft. Editing keeps it, so a
 * reload can bring the same unfinished Transfer back. An already-recorded
 * answer keeps it too: the Dispatcher still has values to copy into a
 * correction, and the entry key has to survive until they confirm.
 */
export function applyTransferDraftEvent(store: TransferDraftStore, userId: string, tenantId: string, event: TransferDraftEvent): void {
  if (event === 'edit' || event === 'already-recorded')
    return
  store.removeItem(transferDraftKey(userId, tenantId))
}
