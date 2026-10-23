import type { SQL } from 'drizzle-orm'
import type { Logger, TenantTransaction } from '../../../core/index'
import type { PlaceReferenceCheck } from '../maps-port'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { locationKindSchema, PLACE_REF_MAX_LENGTH } from '../../../../shared'

/**
 * One night, one Tenant. The nightly tick publishes at most this many
 * checks; the rest stay due until a later night (ADR-0052).
 */
export const PLACE_REFRESH_BATCH = 100

/**
 * A clear is held back when at least this many non-address Locations in
 * the batch are gone. Half of a smaller batch is not enough: a handful of
 * NOT_FOUND answers can be real (ADR-0052).
 */
const BREAKER_GONE = 10

const dueRowSchema = z.object({
  id: z.uuid(),
  kind: locationKindSchema,
  placeRef: z.string(),
})

const dueRows = z.object({
  rows: z.array(dueRowSchema),
})

type DueLocation = z.infer<typeof dueRowSchema>

type CountedOutcome = 'same' | 'replaced' | 'gone' | 'unavailable' | 'invalid'

interface Decision {
  readonly location: DueLocation
  readonly outcome: CountedOutcome
  /** Trimmed id, only when the outcome is replaced. */
  readonly placeRef?: string
}

/**
 * Check this Tenant's due Google references and write the answers.
 * The session is already open. The select is the due rule: active, provider
 * `google`, never checked or checked more than 12 months before `now`.
 * `now` is the tick's instant, so a retry the next day still judges that night.
 * An invalid replacement id is `invalid` and writes nothing. A failure of
 * the port is `unavailable` and writes nothing. Gone clears the provider,
 * the reference, and the time, and does not touch the address.
 * Every write names the reference that was read, so an office pick in
 * between matches no row and wins.
 */
export async function refreshPlaceReferences(options: {
  readonly now: Date
  readonly transaction: TenantTransaction
  readonly places: { checkPlaceRef: (placeRef: string) => Promise<PlaceReferenceCheck> }
  readonly log: Logger
}): Promise<void> {
  const selected = dueRows.parse(await readDue(options.transaction, options.now))
  const decisions: Decision[] = []
  for (const location of selected.rows)
    decisions.push(await decide(location, options.places))

  const tripped = breakerTripped(decisions)
  for (const decision of decisions) {
    if (decision.outcome === 'gone' && tripped)
      continue
    await writeDecision(options.transaction, options.now, decision)
  }

  const counts = countDecisions(decisions)
  const line = { event: 'locations.place_refresh', ...counts, tripped }
  if (tripped)
    options.log.warn(line)
  else
    options.log.info(line)
}

/**
 * The same predicate as `app.tenants_due_place_refresh`: null or older
 * than 12 months, active, and a google reference. The batch is the oldest,
 * with a null check time before any timestamp.
 */
function dueQuery(now: Date): SQL {
  const batch = sql.raw(String(PLACE_REFRESH_BATCH))
  return sql`
    select id, kind, place_ref as "placeRef"
    from app.locations
    where archived_at is null
      and place_provider = 'google'
      and place_ref is not null
      and (
        place_ref_checked_at is null
        or place_ref_checked_at < (cast(${now} as timestamptz) - interval '12 months')
      )
    order by place_ref_checked_at asc nulls first, id
    limit ${batch}
  `
}

async function decide(
  location: DueLocation,
  places: { checkPlaceRef: (placeRef: string) => Promise<PlaceReferenceCheck> },
): Promise<Decision> {
  let answer: PlaceReferenceCheck
  try {
    answer = await places.checkPlaceRef(location.placeRef)
  }
  catch {
    // The message can carry the reference. It is not logged.
    return { location, outcome: 'unavailable' }
  }
  if (answer.outcome !== 'replaced')
    return { location, outcome: answer.outcome }
  const placeRef = acceptedReplacement(answer.placeRef)
  if (placeRef === null)
    return { location, outcome: 'invalid' }
  // Padding around the same id is not a new reference. Stamp the time.
  if (placeRef === location.placeRef)
    return { location, outcome: 'same' }
  return { location, outcome: 'replaced', placeRef }
}

/**
 * The stored-reference check: trimmed, length 1..PLACE_REF_MAX_LENGTH.
 * A blank or over-long id is not a replacement. The caller keeps the row.
 */
function acceptedReplacement(placeRef: string): string | null {
  const trimmed = placeRef.trim()
  if (trimmed.length < 1 || trimmed.length > PLACE_REF_MAX_LENGTH)
    return null
  return trimmed
}

/**
 * More than half of the non-address rows, and at least 10, are gone.
 * Address-kind rows are not in the count. They are still held back once
 * the breaker trips.
 */
function breakerTripped(decisions: readonly Decision[]): boolean {
  const counted = decisions.filter(decision => decision.location.kind !== 'address')
  const gone = counted.filter(decision => decision.outcome === 'gone').length
  return gone >= BREAKER_GONE && gone * 2 > counted.length
}

async function writeDecision(
  transaction: TenantTransaction,
  now: Date,
  decision: Decision,
): Promise<void> {
  const location = decision.location
  if (decision.outcome === 'same') {
    await write(transaction, sql`
      update app.locations
      set place_ref_checked_at = ${now}
      where id = ${location.id}
        and place_provider = 'google'
        and place_ref is not distinct from ${location.placeRef}
        and archived_at is null
    `)
    return
  }
  if (decision.outcome === 'replaced' && decision.placeRef !== undefined) {
    await write(transaction, sql`
      update app.locations
      set place_ref = ${decision.placeRef},
          place_ref_checked_at = ${now}
      where id = ${location.id}
        and place_provider = 'google'
        and place_ref is not distinct from ${location.placeRef}
        and archived_at is null
    `)
    return
  }
  if (decision.outcome === 'gone') {
    await write(transaction, sql`
      update app.locations
      set place_provider = null,
          place_ref = null,
          place_ref_checked_at = null
      where id = ${location.id}
        and place_provider = 'google'
        and place_ref is not distinct from ${location.placeRef}
        and archived_at is null
    `)
  }
}

/**
 * Drizzle puts bound parameters on `Error.message`, and that text is not
 * redacted. A reference in a failed read or write must not be rethrown.
 */
async function readDue(transaction: TenantTransaction, now: Date): Promise<unknown> {
  try {
    return await transaction.execute(dueQuery(now))
  }
  catch {
    throw new Error('Location place refresh failed')
  }
}

async function write(transaction: TenantTransaction, query: SQL): Promise<void> {
  try {
    await transaction.execute(query)
  }
  catch {
    throw new Error('Location place refresh failed')
  }
}

function countDecisions(decisions: readonly Decision[]): Record<CountedOutcome, number> {
  const counts: Record<CountedOutcome, number> = {
    same: 0,
    replaced: 0,
    gone: 0,
    unavailable: 0,
    invalid: 0,
  }
  for (const decision of decisions)
    counts[decision.outcome] += 1
  return counts
}
