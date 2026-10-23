import type { SQL } from 'drizzle-orm'
import type { CreateTransfer, DeclineAlert, RecordedCreate, Ride, Transfer, TransferDayRide, TransferField } from '../../../../shared'
import type { Logger, TenantTransaction } from '../../../core/index'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { canCorrectTransfer, emptyBoardWarnings, localDayBounds, officeGroupPassengerCount, OPERATIONAL_DAY_START_DEFAULT, paymentMethodSchema, rideIsInProgress, rideStateSchema, StaleSaveError, TRANSFER_CORRECTION_FIELDS, TRANSFER_DURATION_DEFAULT_MINUTES, TRANSFER_FIELDS, TransferInputError, transferPriceSchema, unclosedMarkOn } from '../../../../shared'
import { getLogger } from '../../../core/index'
import { appendAuditEntry } from '../../audit'
import { ClientNotFoundError, loadClients } from '../../clients'
import { loadLocation, LocationArchivedError } from '../../locations'
import { TransferNotCorrectableError, TransferNotFoundError, TransferNotMainError } from './transfer-errors'

const transferRowSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  pickupAt: z.unknown(),
  startLocationId: z.uuid(),
  endLocationId: z.uuid(),
  passengerCount: z.number().int(),
  guestName: z.string(),
  flightNumber: z.string().nullable(),
  price: z.union([z.string(), z.number()]),
  payment: paymentMethodSchema,
  airportMark: z.boolean(),
  luggageCount: z.number().int(),
  childSeatCount: z.number().int(),
  note: z.string().nullable(),
  tabla: z.string(),
  clientReference: z.string().nullable(),
  mainTransferId: z.uuid().nullable(),
  groupPassengerCount: z.number().int().nullable(),
  landingAt: z.unknown().nullish(),
  expectedArrival: z.unknown().nullish(),
})

const rideRowSchema = z.object({
  id: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
})

const dayRowSchema = transferRowSchema.omit({ id: true }).extend({
  rideId: z.uuid(),
  transferId: z.uuid(),
  state: rideStateSchema,
  driverId: z.uuid().nullable(),
  vehicleId: z.uuid().nullable(),
  mustAccept: z.boolean().nullable(),
  partnerId: z.uuid().nullable(),
  unfinishedExtraVehicleCount: z.number().int().nonnegative(),
  version: z.number().int(),
  changedAt: z.unknown().nullable(),
  changedByName: z.string().min(1).nullable(),
})

const transferColumns = sql`
  id,
  client_id as "clientId",
  pickup_at as "pickupAt",
  start_location_id as "startLocationId",
  end_location_id as "endLocationId",
  passenger_count as "passengerCount",
  guest_name as "guestName",
  flight_number as "flightNumber",
  price,
  payment,
  airport_mark as "airportMark",
  luggage_count as "luggageCount",
  child_seat_count as "childSeatCount",
  note,
  tabla,
  client_reference as "clientReference",
  link as "mainTransferId",
  group_passenger_count as "groupPassengerCount"
`

/**
 * Insert one Transfer and its one unassigned Ride, then append
 * `transfer.created` on this transaction. The entry names ids and field
 * names. It does not store the guest name, the flight, the note, the tabla,
 * the Client reference, the price, the channel, the external id, or a
 * passenger count. An extra vehicle's entry also holds the main Transfer's
 * id. The caller has already required a dispatcher or an admin, and has
 * already checked that role before this lookup. `externalId` is required:
 * this function does not assign one. A repeat of the same manual external id
 * returns the stored Transfer and writes nothing, including nothing on the
 * main Transfer (ADR-0035, ADR-0054).
 */
export interface ExtraVehicleCreate {
  readonly mainTransferId: string
  /** Null when the body left the group count out. Required when the main row has none. */
  readonly groupPassengerCount: number | null
  /** The main Transfer's opened version. Required when this create stores the count. */
  readonly mainVersion: number | null
}

export async function recordTransfer(
  transaction: TenantTransaction,
  actorUserId: string,
  input: CreateTransfer,
  externalId: string,
  log?: Logger,
  link: ExtraVehicleCreate | null = null,
): Promise<Omit<RecordedCreate, 'fullyBooked'>> {
  // The key is resolved before any catalog read, so a different payload
  // is not applied and a missing Client does not turn a repeat into an error.
  // A repeat also skips the main Transfer, so it cannot store a group count.
  const existing = await loadManualTransfer(transaction, externalId)
  if (existing) {
    logAlreadyRecorded(log, existing.transfer.id)
    return { ...existing, alreadyRecorded: true }
  }

  const client = (await loadClients(transaction)).find(row => row.id === input.clientId)
  if (!client)
    throw new ClientNotFoundError()

  const start = await loadLocation(transaction, input.startLocationId)
  if (start.archivedAt !== null)
    throw new LocationArchivedError()
  const end = await loadLocation(transaction, input.endLocationId)
  if (end.archivedAt !== null)
    throw new LocationArchivedError()

  // The one-level check holds the main Transfer's row. A repeat already
  // returned, so this lock cannot write a group count onto a duplicate.
  const main = link === null ? null : await lockMainForExtraVehicle(transaction, link)
  const inserted = z.object({ rows: z.array(transferRowSchema) }).parse(await writeTransfer(transaction, sql`
    insert into app.transfers (
      client_id, pickup_at, start_location_id, end_location_id,
      passenger_count, guest_name, flight_number, price, payment,
      airport_mark, luggage_count, child_seat_count, note, tabla, client_reference,
      link, channel, external_id
    )
    values (
      ${input.clientId}, ${input.pickupAt}, ${input.startLocationId}, ${input.endLocationId},
      ${input.passengerCount}, ${input.guestName}, ${input.flightNumber}, ${input.price}, ${input.payment},
      ${input.airportMark}, ${input.luggageCount}, ${input.childSeatCount}, ${input.note}, ${input.tabla},
      ${input.clientReference}, ${link?.mainTransferId ?? null}, 'manual', ${externalId}
    )
    on conflict (tenant_id, channel, external_id) do nothing
    returning ${transferColumns}
  `))
  const transferRow = inserted.rows[0]
  // The other request committed this key while we were inserting. Read it.
  // The conflict writes no row, so the audit entry below does not run.
  if (!transferRow) {
    const existing = await loadManualTransfer(transaction, externalId)
    if (!existing)
      throw new Error('Transfer write failed')
    logAlreadyRecorded(log, existing.transfer.id)
    return { ...existing, alreadyRecorded: true }
  }
  const transfer = toTransfer(transferRow)

  const rideInserted = z.object({ rows: z.array(rideRowSchema) }).parse(await writeTransfer(transaction, sql`
    insert into app.rides (transfer_id, state)
    values (${transfer.id}, 'unassigned')
    returning id, transfer_id as "transferId", state, driver_id as "driverId", vehicle_id as "vehicleId", must_accept as "mustAccept"
  `))
  const rideRow = rideInserted.rows[0]
  if (!rideRow)
    throw new Error('Transfer write failed')
  const ride = rideRow

  // Store the group count only after the extra vehicle exists, so a
  // conflicting entry key rolls nothing onto the main Transfer.
  if (main !== null && main.countToStore !== null && link !== null && link.mainVersion !== null)
    await storeGroupPassengerCount(transaction, actorUserId, main.row, link.mainVersion, main.countToStore)

  await appendAuditEntry(transaction, {
    action: 'transfer.created',
    actorUserId,
    subjectUserId: null,
    data: {
      transferId: transfer.id,
      rideId: ride.id,
      clientId: transfer.clientId,
      startLocationId: transfer.startLocationId,
      endLocationId: transfer.endLocationId,
      fields: createdFields(input),
      ...(link === null ? {} : { mainTransferId: link.mainTransferId }),
    },
  })
  return { transfer, ride, alreadyRecorded: false }
}

const mainLockSchema = z.object({
  rows: z.array(z.object({
    id: z.uuid(),
    mainTransferId: z.uuid().nullable(),
    groupPassengerCount: z.number().int().nullable(),
    version: z.number().int(),
    clientId: z.uuid(),
    startLocationId: z.uuid(),
    endLocationId: z.uuid(),
    rideId: z.uuid(),
    state: rideStateSchema,
  })),
})

type MainLock = z.infer<typeof mainLockSchema>['rows'][number]

/**
 * Lock the main Transfer and refuse a link that is not one level, or a
 * Ride that is finished or cancelled. When the group count is still empty,
 * the body must bring the count and the opened version. A mismatch is
 * `stale_save` before the extra vehicle is inserted.
 */
async function lockMainForExtraVehicle(
  transaction: TenantTransaction,
  link: ExtraVehicleCreate,
): Promise<{ row: MainLock, countToStore: number | null }> {
  const selected = mainLockSchema.parse(await writeTransfer(transaction, sql`
    select t.id,
           t.link as "mainTransferId",
           t.group_passenger_count as "groupPassengerCount",
           t.version,
           t.client_id as "clientId",
           t.start_location_id as "startLocationId",
           t.end_location_id as "endLocationId",
           r.id as "rideId",
           r.state
    from app.transfers as t
    join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
    where t.id = ${link.mainTransferId}
    for update
  `))
  const row = selected.rows[0]
  // Missing and another Tenant are the same 404. The foreign key agrees.
  if (!row)
    throw new TransferNotFoundError()
  if (row.mainTransferId !== null)
    throw new TransferNotMainError()
  if (!canCorrectTransfer(row.state))
    throw new TransferNotCorrectableError()
  if (row.groupPassengerCount !== null)
    return { row, countToStore: null }
  if (link.groupPassengerCount === null || link.mainVersion === null)
    throw new TransferInputError()
  if (row.version !== link.mainVersion)
    throw new StaleSaveError()
  return { row, countToStore: link.groupPassengerCount }
}

/**
 * The first extra vehicle stores the group count on the main Transfer.
 * The version predicate is the opened version. The audit names the field
 * and not the count. The link column is not written.
 */
async function storeGroupPassengerCount(
  transaction: TenantTransaction,
  actorUserId: string,
  main: MainLock,
  mainVersion: number,
  count: number,
): Promise<void> {
  const written = z.object({ rows: z.array(z.object({ id: z.uuid() })) }).parse(await writeTransfer(transaction, sql`
    update app.transfers
    set group_passenger_count = ${count},
        version = version + 1,
        data_changed_at = now(),
        data_changed_by = ${actorUserId}
    where id = ${main.id}
      and version = ${mainVersion}
    returning id
  `))
  if (!written.rows[0])
    throw new StaleSaveError()
  await appendAuditEntry(transaction, {
    action: 'transfer.corrected',
    actorUserId,
    subjectUserId: null,
    data: {
      transferId: main.id,
      rideId: main.rideId,
      clientId: main.clientId,
      startLocationId: main.startLocationId,
      endLocationId: main.endLocationId,
      fields: TRANSFER_CORRECTION_FIELDS.filter(field => field === 'groupPassengerCount'),
    },
  })
}

/**
 * The manual Transfer already stored under this external id, and its Ride.
 * Channel and external id are not selected. A miss is null.
 */
async function loadManualTransfer(
  transaction: TenantTransaction,
  externalId: string,
): Promise<{ transfer: Transfer, ride: Ride } | null> {
  const selected = z.object({
    rows: z.array(transferRowSchema.extend({
      rideId: z.uuid(),
      state: rideStateSchema,
      driverId: z.uuid().nullable(),
      vehicleId: z.uuid().nullable(),
      mustAccept: z.boolean().nullable(),
    })),
  }).parse(await writeTransfer(transaction, sql`
    select
      t.id,
      t.client_id as "clientId",
      t.pickup_at as "pickupAt",
      t.start_location_id as "startLocationId",
      t.end_location_id as "endLocationId",
      t.passenger_count as "passengerCount",
      t.guest_name as "guestName",
      t.flight_number as "flightNumber",
      t.price,
      t.payment,
      t.airport_mark as "airportMark",
      t.luggage_count as "luggageCount",
      t.child_seat_count as "childSeatCount",
      t.note,
      t.tabla,
      t.client_reference as "clientReference",
      t.link as "mainTransferId",
      t.group_passenger_count as "groupPassengerCount",
      r.id as "rideId",
      r.state,
      r.driver_id as "driverId",
      r.vehicle_id as "vehicleId",
      r.must_accept as "mustAccept"
    from app.transfers as t
    join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
    where t.channel = 'manual' and t.external_id = ${externalId}
  `))
  const row = selected.rows[0]
  if (!row)
    return null
  const { rideId, state, driverId, vehicleId, mustAccept, ...transferRow } = row
  return {
    transfer: toTransfer(transferRow),
    ride: {
      id: rideId,
      transferId: transferRow.id,
      state,
      driverId,
      vehicleId,
      mustAccept,
    },
  }
}

/** One info line. The external id, the guest, and the payload stay off it. */
function logAlreadyRecorded(log: Logger | undefined, transferId: string): void {
  ;(log ?? getLogger()).info({ event: 'transfer.already_recorded', transferId }, 'transfer.already_recorded')
}

/**
 * Rides whose pickup falls on this operational day in the Tenant time zone.
 * The day is `YYYY-MM-DD`, the date of the local start hour. The bounds are
 * that hour and the same hour next date, as UTC instants, so the
 * `(tenant_id, pickup_at)` index can serve the list. A `date` cast of the
 * stored instant cannot, and it would also miss the extra hour or keep the
 * missing hour of a daylight-saving night. A pickup before the start hour is
 * not in this interval; it belongs to the previous operational day.
 * Omitting the hour uses 05:00. The day list passes the stored hour.
 * The unclosed mark uses `now`, the stored landing, and the Tenant
 * transfer duration. It is on 60 minutes after the occupied end
 * (ADR-0055). The day only chooses which Rides are listed.
 */
export async function loadRidesForDay(
  transaction: TenantTransaction,
  day: string,
  timeZone: string,
  startHour = OPERATIONAL_DAY_START_DEFAULT,
  now: Date = new Date(),
  transferDurationMinutes = TRANSFER_DURATION_DEFAULT_MINUTES,
): Promise<TransferDayRide[]> {
  const nowMs = now.getTime()
  if (Number.isNaN(nowMs))
    throw new RangeError('Instant is not a valid time.')
  const bounds = localDayBounds(day, timeZone, startHour)
  const selected = z.object({ rows: z.array(dayRowSchema) }).parse(await transaction.execute(sql`
    select
      r.id as "rideId",
      r.transfer_id as "transferId",
      r.state,
      r.driver_id as "driverId",
      r.vehicle_id as "vehicleId",
      r.must_accept as "mustAccept",
      r.partner_id as "partnerId",
      t.client_id as "clientId",
      t.pickup_at as "pickupAt",
      t.start_location_id as "startLocationId",
      t.end_location_id as "endLocationId",
      t.passenger_count as "passengerCount",
      t.guest_name as "guestName",
      t.flight_number as "flightNumber",
      t.price,
      t.payment,
      t.airport_mark as "airportMark",
      t.luggage_count as "luggageCount",
      t.child_seat_count as "childSeatCount",
      t.note,
      t.tabla,
      t.client_reference as "clientReference",
      t.link as "mainTransferId",
      t.group_passenger_count as "groupPassengerCount",
      -- Unfinished extra vehicles of this Transfer, any day. An extra
      -- vehicle has none: a group is one level. The cancel dialog asks
      -- with this count and sends nothing until the office confirms.
      (
        select count(*)::int
        from app.transfers as extra
        join app.rides as extra_ride
          on extra_ride.transfer_id = extra.id
         and extra_ride.tenant_id = extra.tenant_id
        where extra.tenant_id = t.tenant_id
          and extra.link = t.id
          and extra_ride.state in ('unassigned', 'assigned', 'accepted', 'handed_off')
      ) as "unfinishedExtraVehicleCount",
      t.landing_at as "landingAt",
      t.expected_arrival_at as "expectedArrival",
      t.version,
      t.data_changed_at as "changedAt",
      changed_by.name as "changedByName"
    from app.rides as r
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    -- The view is already this session's tenant. The tenant predicate keeps
    -- another tenant's name off the row if that filter is ever wider.
    left join app.tenant_member as changed_by
      on changed_by.user_id = t.data_changed_by
     and changed_by.tenant_id = t.tenant_id
    where t.pickup_at >= ${bounds.start.toISOString()} and t.pickup_at < ${bounds.end.toISOString()}
    order by t.pickup_at, r.id
  `))
  return selected.rows.map(row => toDayRide(row, nowMs, transferDurationMinutes))
}

/**
 * Decline alerts whose Ride picks up on this operational day. The board
 * shows them as soon as it reads the day. The name is not stored here.
 */
export async function loadDeclineAlertsForDay(
  transaction: TenantTransaction,
  day: string,
  timeZone: string,
  startHour = OPERATIONAL_DAY_START_DEFAULT,
): Promise<DeclineAlert[]> {
  const bounds = localDayBounds(day, timeZone, startHour)
  const selected = z.object({
    rows: z.array(z.object({
      id: z.uuid(),
      rideId: z.uuid(),
      driverId: z.uuid(),
      driverName: z.string().min(1),
      guestName: z.string().min(1),
    })),
  }).parse(await transaction.execute(sql`
    select a.id,
           a.ride_id as "rideId",
           a.driver_id as "driverId",
           d.name as "driverName",
           t.guest_name as "guestName"
    from app.ride_alert as a
    join app.rides as r on r.id = a.ride_id and r.tenant_id = a.tenant_id
    join app.transfers as t on t.id = r.transfer_id and t.tenant_id = r.tenant_id
    join app.drivers as d on d.id = a.driver_id and d.tenant_id = a.tenant_id
    where a.kind = 'declined'
      and t.pickup_at >= ${bounds.start.toISOString()}
      and t.pickup_at < ${bounds.end.toISOString()}
    order by a.created_at, a.id
  `))
  return selected.rows
}

function createdFields(input: CreateTransfer): TransferField[] {
  const set = new Set<TransferField>([
    'pickupAt',
    'passengerCount',
    'guestName',
    'price',
    'payment',
    'airportMark',
    'luggageCount',
    'childSeatCount',
  ])
  if (input.flightNumber !== null)
    set.add('flightNumber')
  if (input.note !== null)
    set.add('note')
  if (input.tabla !== '')
    set.add('tabla')
  if (input.clientReference !== null)
    set.add('clientReference')
  return TRANSFER_FIELDS.filter(field => set.has(field))
}

function toTransfer(row: z.infer<typeof transferRowSchema>): Transfer {
  return {
    id: row.id,
    clientId: row.clientId,
    pickupAt: toInstant(row.pickupAt),
    startLocationId: row.startLocationId,
    endLocationId: row.endLocationId,
    passengerCount: row.passengerCount,
    guestName: row.guestName,
    flightNumber: row.flightNumber,
    price: toPrice(row.price),
    payment: row.payment,
    airportMark: row.airportMark,
    luggageCount: row.luggageCount,
    childSeatCount: row.childSeatCount,
    note: row.note,
    tabla: row.tabla,
    clientReference: row.clientReference,
    mainTransferId: row.mainTransferId,
    groupPassengerCount: officeGroupPassengerCount(row.mainTransferId, row.groupPassengerCount, row.passengerCount),
  }
}

function toDayRide(
  row: z.infer<typeof dayRowSchema>,
  nowMs: number,
  transferDurationMinutes: number,
): TransferDayRide {
  const pickupAt = toInstant(row.pickupAt)
  const landingAt = row.landingAt == null ? null : toInstant(row.landingAt)
  const expectedArrival = row.expectedArrival == null ? null : toInstant(row.expectedArrival)
  const pickupMs = new Date(pickupAt).getTime()
  const inProgress = rideIsInProgress(row.state, row.mustAccept, row.driverId, pickupMs, nowMs)
  // In progress and handed off share one rule. Every other state stays off.
  const openForMark = inProgress || row.state === 'handed_off'
  return {
    rideId: row.rideId,
    transferId: row.transferId,
    state: row.state,
    driverId: row.driverId,
    vehicleId: row.vehicleId,
    mustAccept: row.mustAccept,
    partnerId: row.partnerId,
    clientId: row.clientId,
    pickupAt,
    startLocationId: row.startLocationId,
    endLocationId: row.endLocationId,
    passengerCount: row.passengerCount,
    guestName: row.guestName,
    flightNumber: row.flightNumber,
    price: toPrice(row.price),
    payment: row.payment,
    airportMark: row.airportMark,
    luggageCount: row.luggageCount,
    childSeatCount: row.childSeatCount,
    note: row.note,
    tabla: row.tabla,
    clientReference: row.clientReference,
    mainTransferId: row.mainTransferId,
    groupPassengerCount: officeGroupPassengerCount(row.mainTransferId, row.groupPassengerCount, row.passengerCount),
    unfinishedExtraVehicleCount: row.unfinishedExtraVehicleCount,
    landingAt,
    expectedArrival,
    version: row.version,
    changedAt: row.changedAt == null ? null : toInstant(row.changedAt),
    changedByName: row.changedByName,
    unclosedMark: openForMark && unclosedMarkOn({
      pickupAt,
      landingAt,
      nowMs,
      transferDurationMinutes,
    }),
    warnings: emptyBoardWarnings(),
  }
}

/**
 * node-pg may return a Date or a timestamp string. The API always uses ISO-8601 UTC.
 * The office home read uses the same conversion.
 */
export function toInstant(value: unknown): string {
  if (value instanceof Date)
    return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime()))
      throw new Error('Transfer pickup_at is not a timestamp.')
    return parsed.toISOString()
  }
  throw new Error('Transfer pickup_at is not a timestamp.')
}

/** numeric comes back as text. The API always uses two decimal places. The office home read uses this too. */
export function toPrice(value: string | number): string {
  const parsed = transferPriceSchema.safeParse(typeof value === 'number' ? value.toFixed(2) : normalizePriceText(value))
  if (!parsed.success)
    throw new Error('Transfer price is not numeric.')
  return parsed.data
}

function normalizePriceText(value: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value))
    return value
  const cents = Math.round(Number(value) * 100)
  const whole = Math.trunc(cents / 100)
  const fraction = String(cents % 100).padStart(2, '0')
  return `${whole}.${fraction}`
}

/**
 * Run one insert. Every failure becomes a fixed message.
 * Drizzle copies the bound parameters into `Error.message`, and that text
 * is not redacted, so the original error is never rethrown. A guest name
 * in that text would otherwise land in the log.
 */
async function writeTransfer(transaction: TenantTransaction, query: SQL): Promise<unknown> {
  try {
    return await transaction.execute(query)
  }
  catch {
    throw new Error('Transfer write failed')
  }
}
