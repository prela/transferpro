import { z } from 'zod'
import { paymentMethodSchema } from './transfer'

/**
 * An unfinished new Transfer stays in the browser (ADR-0038). The key is
 * the user and the Tenant, so the next person on a shared computer does not
 * read it. It expires 24 hours after it was written. Save, discard, and
 * sign-out remove it. Nothing here is a request: the server never sees it.
 */
export const TRANSFER_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

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
  clientReference: z.string(),
  price: z.string(),
  payment: paymentMethodSchema.nullable(),
  flight: z.string(),
  airportMark: z.boolean(),
  tabla: z.string(),
  luggage: z.string(),
  childSeats: z.string(),
  note: z.string(),
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

export type TransferDraftEvent = 'save' | 'discard' | 'sign-out' | 'edit'

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
    && fields.clientReference.trim() === ''
    && fields.price.trim() === ''
    && fields.flight.trim() === ''
    && fields.tabla.trim() === ''
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
 * reload can bring the same unfinished Transfer back.
 */
export function applyTransferDraftEvent(store: TransferDraftStore, userId: string, tenantId: string, event: TransferDraftEvent): void {
  if (event === 'edit')
    return
  store.removeItem(transferDraftKey(userId, tenantId))
}
