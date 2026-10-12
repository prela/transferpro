import type { RideState } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { chooseFlightArrival, FLIGHT_ASK_LEAD_MS, flightAskDates, flightDesignator, landingTimeInFuture, parseFlightArrivals, storeExpectedArrival } from '../../../../shared'
import { hideDatabaseError } from '../../../core/index'

/**
 * The only way Transfers learn a live status. This ticket ships no vendor.
 * A call names the designator and the pickup date plus the day on either side.
 */
export interface FlightStatusPort {
  arrivals: (query: {
    readonly designator: string
    readonly dates: readonly [string, string, string]
  }) => Promise<unknown>
}

const finished: readonly RideState[] = ['done', 'no-show', 'cancelled']

/**
 * The fact the work-order port receives when an expected arrival moves.
 * The mail wording is a later ticket. This does not add a channel.
 */
export interface ArrivalMovedFact {
  readonly rideId: string
  readonly driverId: string
  readonly previous: Date
  readonly next: Date
}

/** ADR-0026's port, for this fact only. The v1 mail adapter is not this ticket. */
export interface ArrivalNoticePort {
  arrivalMoved: (fact: ArrivalMovedFact) => Promise<void>
}

/** This ticket does not write the mail. The ask still hands the fact here. */
export const noArrivalNotice: ArrivalNoticePort = {
  async arrivalMoved() {},
}

interface TrackedRide {
  readonly rideId: string
  readonly transferId: string
  readonly state: RideState
  readonly driverId: string | null
  readonly pickupAt: Date
  readonly flightNumber: string | null
  readonly airportMark: boolean
  readonly iata: string | null
  readonly landingAt: Date | null
  readonly expectedArrival: Date | null
  readonly expectedArrivalBasis: Date | null
  readonly timeZone: string
}

const trackedRowSchema = z.object({
  rideId: z.uuid(),
  transferId: z.uuid(),
  state: z.enum(['unassigned', 'assigned', 'accepted', 'done', 'no-show', 'cancelled']),
  driverId: z.uuid().nullable(),
  pickupAt: z.unknown(),
  flightNumber: z.string().nullable(),
  airportMark: z.boolean(),
  iata: z.string().nullable(),
  landingAt: z.unknown().nullable(),
  expectedArrival: z.unknown().nullable(),
  expectedArrivalBasis: z.unknown().nullable(),
  timeZone: z.string().min(1),
})

const recordRowSchema = z.object({
  rows: z.array(z.object({
    transferId: z.uuid(),
    state: z.enum(['unassigned', 'assigned', 'accepted', 'done', 'no-show', 'cancelled']),
    landingAt: z.unknown().nullable(),
  })),
})

export class LandingTimeInFutureError extends Error {
  constructor() {
    super('Landing time is still in the future.')
    this.name = 'LandingTimeInFutureError'
  }
}

export class LandingTimeClosedError extends Error {
  constructor() {
    super('Landing time cannot change after the Ride is finished.')
    this.name = 'LandingTimeClosedError'
  }
}

function asInstant(value: unknown): Date | null {
  if (value === null || value === undefined)
    return null
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function toTracked(row: z.infer<typeof trackedRowSchema>): TrackedRide | null {
  const pickupAt = asInstant(row.pickupAt)
  if (pickupAt === null)
    return null
  return {
    rideId: row.rideId,
    transferId: row.transferId,
    state: row.state,
    driverId: row.driverId,
    pickupAt,
    flightNumber: row.flightNumber,
    airportMark: row.airportMark,
    iata: row.iata,
    landingAt: asInstant(row.landingAt),
    expectedArrival: asInstant(row.expectedArrival),
    expectedArrivalBasis: asInstant(row.expectedArrivalBasis),
    timeZone: row.timeZone,
  }
}

/**
 * Unfinished airport pickup, one designator, an IATA code, an empty landing
 * time, and a pickup no more than 12 hours ahead. A row outside that set
 * is not asked. The guest name is not read.
 */
function isAsked(ride: TrackedRide, now: Date): boolean {
  if (finished.includes(ride.state))
    return false
  if (!ride.airportMark)
    return false
  if (ride.iata === null)
    return false
  if (ride.landingAt !== null)
    return false
  if (flightDesignator(ride.flightNumber) === null)
    return false
  return ride.pickupAt.getTime() <= now.getTime() + FLIGHT_ASK_LEAD_MS
}

async function loadTracked(transaction: TenantTransaction): Promise<TrackedRide[]> {
  const selected = z.object({ rows: z.array(trackedRowSchema) }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        r.id as "rideId",
        t.id as "transferId",
        r.state,
        r.driver_id as "driverId",
        t.pickup_at as "pickupAt",
        t.flight_number as "flightNumber",
        t.airport_mark as "airportMark",
        l.iata,
        t.landing_at as "landingAt",
        t.expected_arrival_at as "expectedArrival",
        t.expected_arrival_basis_at as "expectedArrivalBasis",
        s.time_zone as "timeZone"
      from app.rides as r
      join app.transfers as t
        on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      join app.locations as l
        on l.id = t.start_location_id and l.tenant_id = t.tenant_id
      join app.tenant_settings as s
        on s.tenant_id = r.tenant_id
    `),
    'Flight landing read failed',
  ))
  return selected.rows.flatMap((row) => {
    const tracked = toTracked(row)
    return tracked === null ? [] : [tracked]
  })
}

/**
 * Write the actual time only while the column is still empty, so a time a
 * person stored in the same moment is left in place. The Ride state is not
 * in this statement.
 */
async function writeLanding(
  transaction: TenantTransaction,
  transferId: string,
  landedAt: Date,
): Promise<boolean> {
  const written = z.object({
    rows: z.array(z.object({ id: z.uuid() })),
  }).parse(await hideDatabaseError(
    () => transaction.execute(sql`
      update app.transfers
      set landing_at = ${landedAt.toISOString()}
      where id = ${transferId}
        and landing_at is null
      returning id
    `),
    'Flight landing write failed',
  ))
  return written.rows.length === 1
}

/**
 * The current estimate and the basis it is measured against. The Ride
 * state is not in this statement, so an accepted Ride stays accepted.
 */
async function writeExpectedArrival(
  transaction: TenantTransaction,
  transferId: string,
  expectedArrival: Date,
  basis: Date,
): Promise<void> {
  await hideDatabaseError(
    () => transaction.execute(sql`
      update app.transfers
      set expected_arrival_at = ${expectedArrival.toISOString()},
          expected_arrival_basis_at = ${basis.toISOString()}
      where id = ${transferId}
    `),
    'Expected arrival write failed',
  )
}

export interface FlightLandingAsk {
  readonly now: Date
  readonly transaction: TenantTransaction
  readonly status: FlightStatusPort
  readonly notices: ArrivalNoticePort
  readonly log: Logger
}

/**
 * One ask for the Tenant already on the transaction. The tenant id comes
 * from that session, never from a request. Matching stays here; the job
 * only calls this.
 */
export async function refreshFlightLandings(ask: FlightLandingAsk): Promise<void> {
  const rides = await loadTracked(ask.transaction)
  for (const ride of rides) {
    if (!isAsked(ride, ask.now))
      continue
    const designator = flightDesignator(ride.flightNumber)
    const iata = ride.iata
    if (designator === null || iata === null)
      continue
    const payload = await ask.status.arrivals({
      designator,
      dates: flightAskDates(ride.pickupAt, ride.timeZone),
    })
    const arrivals = parseFlightArrivals(payload)
    if (arrivals === null) {
      // The payload can carry a flight number. The line does not.
      ask.log.info({ rideId: ride.rideId, outcome: 'status-unreadable' }, 'flight landing ask')
      continue
    }
    if (arrivals.length === 0) {
      ask.log.info({ rideId: ride.rideId, outcome: 'status-empty' }, 'flight landing ask')
      continue
    }
    const choice = chooseFlightArrival(arrivals, ride.pickupAt, iata)
    const reported = choice.kind === 'expected' || choice.kind === 'landed'
      ? choice.expectedArrival
      : null
    if (reported !== null) {
      const update = storeExpectedArrival(
        { expectedArrival: ride.expectedArrival, basis: ride.expectedArrivalBasis },
        reported,
        ride.driverId !== null,
      )
      await writeExpectedArrival(ask.transaction, ride.transferId, update.expectedArrival, update.basis)
      if (update.moved !== null && ride.driverId !== null) {
        await ask.notices.arrivalMoved({
          rideId: ride.rideId,
          driverId: ride.driverId,
          previous: update.moved.previous,
          next: update.moved.next,
        })
        ask.log.info({ rideId: ride.rideId, outcome: 'arrival-moved' }, 'flight landing ask')
      }
      else {
        ask.log.info({ rideId: ride.rideId, outcome: 'arrival-stored' }, 'flight landing ask')
      }
    }
    if (choice.kind !== 'landed') {
      if (reported === null)
        ask.log.info({ rideId: ride.rideId, outcome: 'landing-unchanged' }, 'flight landing ask')
      continue
    }
    if (landingTimeInFuture(choice.landedAt, ask.now)) {
      ask.log.info({ rideId: ride.rideId, outcome: 'landing-in-future' }, 'flight landing ask')
      continue
    }
    const stored = await writeLanding(ask.transaction, ride.transferId, choice.landedAt)
    ask.log.info({
      rideId: ride.rideId,
      outcome: stored ? 'landing-stored' : 'landing-unchanged',
    }, 'flight landing ask')
  }
}

/**
 * One tick. `tenantIds` are the Tenants the schedule found on their rows.
 * Each one is opened by the caller. This function does not sleep, and it
 * does not invent a request id.
 */
export async function askFlightLandings(input: {
  readonly now: Date
  readonly tenantIds: readonly string[]
  readonly withTenant: (tenantId: string, run: (transaction: TenantTransaction) => Promise<void>) => Promise<void>
  readonly status: FlightStatusPort
  readonly notices: ArrivalNoticePort
  readonly log: Logger
}): Promise<void> {
  for (const tenantId of input.tenantIds) {
    await input.withTenant(tenantId, async (transaction) => {
      await refreshFlightLandings({
        now: input.now,
        transaction,
        status: input.status,
        notices: input.notices,
        log: input.log,
      })
    })
  }
}

/**
 * A person records or clears the landing time. A future instant is refused
 * and the stored value stays. The screen, the roles, and the audit are
 * `recordRideLanding`. Finished Rides are refused so a closed Ride cannot
 * gain a time here.
 * A missing Ride uses the same fixed read failure. The Ride state is not updated.
 */
export async function recordLandingTime(
  transaction: TenantTransaction,
  rideId: string,
  landingAt: Date | null,
  now: Date,
): Promise<void> {
  if (landingAt !== null && landingTimeInFuture(landingAt, now))
    throw new LandingTimeInFutureError()

  const selected = recordRowSchema.parse(await hideDatabaseError(
    () => transaction.execute(sql`
      select
        t.id as "transferId",
        r.state,
        t.landing_at as "landingAt"
      from app.rides as r
      join app.transfers as t
        on t.id = r.transfer_id and t.tenant_id = r.tenant_id
      where r.id = ${rideId}
    `),
    'Landing time read failed',
  ))
  const row = selected.rows[0]
  if (!row)
    throw new Error('Landing time read failed')
  if (finished.includes(row.state))
    throw new LandingTimeClosedError()

  const stored = landingAt === null ? null : landingAt.toISOString()
  await hideDatabaseError(
    () => transaction.execute(sql`
      update app.transfers
      set landing_at = ${stored}
      where id = ${row.transferId}
    `),
    'Landing time write failed',
  )
}

/** This ticket has no vendor. An empty list stores nothing and notifies nobody. */
export const noFlightStatusVendor: FlightStatusPort = {
  async arrivals() {
    return []
  },
}
