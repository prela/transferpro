import { loadEnvFile } from 'node:process'
import pg from 'pg'
import { afterAll, beforeAll, expect, it } from 'vitest'

loadEnvFile('.env')
loadEnvFile('.env.migrate')

/**
 * RLS seam: a fake cannot prove Tenant A is hidden from Tenant B.
 * The observation is the rows and the errors, not the policy text.
 */
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error('DATABASE_URL is required (the transferpro_app role)')

const migrateUrl = process.env.DATABASE_MIGRATE_URL
if (!migrateUrl)
  throw new Error('DATABASE_MIGRATE_URL is required (the transferpro_owner role)')

const pool = new pg.Pool({ connectionString: databaseUrl })
const ownerPool = new pg.Pool({ connectionString: migrateUrl })

const tenantA = 'd1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1'
const tenantB = 'd2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2'

/**
 * Rides go first. An assigned Ride names a Driver and a Vehicle, and a later
 * migration refuses an assigned Ride that is missing either. The same deletes
 * run after the file so a run cannot leave those rows behind.
 */
async function deleteTransferFixtures(owner: pg.PoolClient): Promise<void> {
  await owner.query('delete from app.rides where tenant_id in ($1, $2)', [tenantA, tenantB])
  await owner.query('delete from app.roster where tenant_id in ($1, $2)', [tenantA, tenantB])
  await owner.query('delete from app.transfers where tenant_id in ($1, $2)', [tenantA, tenantB])
  await owner.query('delete from app.drivers where tenant_id in ($1, $2)', [tenantA, tenantB])
  await owner.query('delete from app.vehicles where tenant_id in ($1, $2)', [tenantA, tenantB])
  await owner.query('delete from app.locations where tenant_id in ($1, $2)', [tenantA, tenantB])
  await owner.query('delete from app.clients where tenant_id in ($1, $2)', [tenantA, tenantB])
}

beforeAll(async () => {
  const owner = await ownerPool.connect()
  try {
    await deleteTransferFixtures(owner)
  }
  finally {
    owner.release()
  }
})

afterAll(async () => {
  const owner = await ownerPool.connect()
  try {
    await deleteTransferFixtures(owner)
  }
  finally {
    owner.release()
    await pool.end()
    await ownerPool.end()
  }
})

async function withTenant<T>(
  tenantId: string,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query('select set_config(\'app.tenant_id\', $1, true)', [tenantId])
    const result = await run(client)
    await client.query('commit')
    return result
  }
  catch (error) {
    await client.query('rollback')
    throw error
  }
  finally {
    client.release()
  }
}

const transferInsert = `
  insert into app.transfers (
    client_id, pickup_at, start_location_id, end_location_id,
    passenger_count, guest_name, flight_number, price, payment,
    airport_mark, luggage_count, child_seat_count, note
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
`

it('forces row level security on transfers and rides', async () => {
  const client = await pool.connect()
  try {
    const seen = await client.query<{ relname: string, relrowsecurity: boolean, relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'app' and c.relname in ('transfers', 'rides')
       order by c.relname`,
    )
    expect(seen.rows).toEqual([
      { relname: 'rides', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'transfers', relrowsecurity: true, relforcerowsecurity: true },
    ])
  }
  finally {
    client.release()
  }
})

it('tenant B cannot read or change Tenant A transfers or rides, and a second Ride is refused', async () => {
  const seeded = await withTenant(tenantA, async (client) => {
    const clientRow = await client.query<{ id: string }>(
      `insert into app.clients (name, kind) values ('Agencija Mora', 'agency') returning id`,
    )
    const start = await client.query<{ id: string }>(
      `insert into app.locations (name, kind) values ('Zračna luka Dubrovnik', 'airport') returning id`,
    )
    const end = await client.query<{ id: string }>(
      `insert into app.locations (name, kind) values ('Hotel Park', 'hotel') returning id`,
    )
    const transfer = await client.query<{ id: string }>(
      `${transferInsert} returning id`,
      [
        clientRow.rows[0]?.id,
        '2026-10-06T22:30:00.000Z',
        start.rows[0]?.id,
        end.rows[0]?.id,
        2,
        'Ana Anić',
        'OU 384',
        '42.50',
        'invoice_to_agency',
        false,
        1,
        0,
        null,
      ],
    )
    const ride = await client.query<{ id: string, state: string, driver_id: string | null, vehicle_id: string | null }>(
      `insert into app.rides (transfer_id, state) values ($1, 'unassigned') returning id, state, driver_id, vehicle_id`,
      [transfer.rows[0]?.id],
    )
    return {
      clientId: clientRow.rows[0]?.id,
      transferId: transfer.rows[0]?.id,
      ride: ride.rows[0],
    }
  })
  expect(seeded.ride).toEqual({
    id: expect.any(String),
    state: 'unassigned',
    driver_id: null,
    vehicle_id: null,
  })

  const seenByB = await withTenant(tenantB, async (client) => {
    const transfers = await client.query('select guest_name from app.transfers')
    const rides = await client.query('select state from app.rides')
    const updated = await client.query(`update app.transfers set payment = 'cash'`)
    const updatedRide = await client.query(`update app.rides set state = 'cancelled'`)
    return {
      transfers: transfers.rows,
      rides: rides.rows,
      updated: updated.rowCount,
      updatedRide: updatedRide.rowCount,
    }
  })
  expect(seenByB.transfers).toEqual([])
  expect(seenByB.rides).toEqual([])
  expect(seenByB.updated).toBe(0)
  expect(seenByB.updatedRide).toBe(0)

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.transfers (tenant_id, client_id, pickup_at, start_location_id, end_location_id, passenger_count, guest_name, price, payment, airport_mark, luggage_count, child_seat_count)
       values ($1, $2, '2026-10-06T10:00:00.000Z', $2, $2, 1, 'Skriveno', 10, 'cash', false, 0, 0)`,
      [tenantA, seeded.clientId],
    ))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client =>
    client.query('update app.transfers set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })
  await expect(withTenant(tenantA, client =>
    client.query('update app.rides set tenant_id = $1', [tenantB]))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client => client.query('delete from app.rides'))).rejects.toMatchObject({ code: '42501' })
  await expect(withTenant(tenantA, client => client.query('delete from app.transfers'))).rejects.toMatchObject({ code: '42501' })

  await expect(withTenant(tenantA, client =>
    client.query(
      `insert into app.rides (transfer_id, state) values ($1, 'unassigned')`,
      [seeded.transferId],
    ))).rejects.toMatchObject({ code: '23505' })

  const seenByA = await withTenant(tenantA, async (client) => {
    return client.query(`select guest_name, payment, airport_mark from app.transfers`)
  })
  expect(seenByA.rows).toEqual([{
    guest_name: 'Ana Anić',
    payment: 'invoice_to_agency',
    airport_mark: false,
  }])
})

it('reserves the Ride states and refuses a bad fare, a bad count, and a Driver on an unassigned Ride', async () => {
  const ids = await withTenant(tenantA, async (client) => {
    const clientRow = await client.query<{ id: string }>(`select id from app.clients limit 1`)
    const locations = await client.query<{ id: string }>(`select id from app.locations order by name`)
    return {
      clientId: clientRow.rows[0]?.id,
      startLocationId: locations.rows[0]?.id,
      endLocationId: locations.rows[1]?.id,
    }
  })

  await expect(withTenant(tenantA, client =>
    client.query(transferInsert, [
      ids.clientId,
      '2026-10-06T12:00:00.000Z',
      ids.startLocationId,
      ids.endLocationId,
      0,
      'Ana Anić',
      null,
      '10.00',
      'cash',
      false,
      0,
      0,
      null,
    ]))).rejects.toMatchObject({ code: '23514' })

  await expect(withTenant(tenantA, client =>
    client.query(transferInsert, [
      ids.clientId,
      '2026-10-06T12:00:00.000Z',
      ids.startLocationId,
      ids.endLocationId,
      1,
      'Ana Anić',
      null,
      '-1.00',
      'cash',
      false,
      0,
      0,
      null,
    ]))).rejects.toMatchObject({ code: '23514' })

  let assignedDriverId = ''
  const reserved = await withTenant(tenantA, async (client) => {
    const transfer = await client.query<{ id: string }>(
      `${transferInsert} returning id`,
      [
        ids.clientId,
        '2026-10-06T12:00:00.000Z',
        ids.startLocationId,
        ids.endLocationId,
        1,
        'Ana Anić',
        null,
        '10.00',
        'card',
        true,
        0,
        0,
        null,
      ],
    )
    const ride = await client.query<{ id: string }>(
      `insert into app.rides (transfer_id, state) values ($1, 'unassigned') returning id`,
      [transfer.rows[0]?.id],
    )
    // `assigned` requires a same-tenant Driver, Vehicle, and must-accept copy.
    const driver = await client.query<{ id: string }>(
      `insert into app.drivers (name, kind, phone, driving_licence_expires_on, transport_licence_expires_on)
       values ('Marko Vozač', 'own', '+385910000001', '2030-01-01', '2030-01-01') returning id`,
    )
    const vehicle = await client.query<{ id: string }>(
      `insert into app.vehicles (
         registration_plate, kind, registration_expires_on, technical_inspection_expires_on, insurance_expires_on
       ) values ('ST1234AA', 'fixed', '2030-01-01', '2030-01-01', '2030-01-01') returning id`,
    )
    await client.query(
      `update app.rides
       set state = 'assigned', driver_id = $2, vehicle_id = $3, must_accept = false
       where id = $1`,
      [ride.rows[0]?.id, driver.rows[0]?.id, vehicle.rows[0]?.id],
    )
    const state = await client.query<{ state: string }>(`select state from app.rides where id = $1`, [ride.rows[0]?.id])
    assignedDriverId = driver.rows[0]?.id ?? ''
    return state.rows[0]?.state
  })
  expect(reserved).toBe('assigned')

  await expect(withTenant(tenantA, client =>
    client.query(`update app.rides set state = 'teleported'`))).rejects.toMatchObject({ code: '23514' })

  await expect(withTenant(tenantA, client =>
    client.query(
      `update app.rides set state = 'unassigned', driver_id = $1 where state = 'unassigned'`,
      [assignedDriverId],
    ))).rejects.toMatchObject({ code: '23514' })
})

it('refuses a Transfer that names another Tenant\'s Client or Location, and a Ride that names another Tenant\'s Transfer', async () => {
  const foreign = await withTenant(tenantA, async (client) => {
    const clientRow = await client.query<{ id: string }>(`select id from app.clients limit 1`)
    const locations = await client.query<{ id: string }>(`select id from app.locations order by name`)
    // No Ride on this Transfer. rides.transfer_id is unique, so a second Ride
    // would fail 23505 before the composite foreign key could.
    const transfer = await client.query<{ id: string }>(
      `${transferInsert} returning id`,
      [
        clientRow.rows[0]?.id,
        '2026-10-06T18:00:00.000Z',
        locations.rows[0]?.id,
        locations.rows[1]?.id,
        1,
        'Ana Anić',
        null,
        '10.00',
        'cash',
        false,
        0,
        0,
        null,
      ],
    )
    return {
      clientId: clientRow.rows[0]?.id,
      startLocationId: locations.rows[0]?.id,
      endLocationId: locations.rows[1]?.id,
      transferId: transfer.rows[0]?.id,
    }
  })

  const own = await withTenant(tenantB, async (client) => {
    const clientRow = await client.query<{ id: string }>(
      `insert into app.clients (name, kind) values ('Hotel Sunce', 'hotel') returning id`,
    )
    const start = await client.query<{ id: string }>(
      `insert into app.locations (name, kind) values ('Zračna luka Split', 'airport') returning id`,
    )
    const end = await client.query<{ id: string }>(
      `insert into app.locations (name, kind) values ('Hotel More', 'hotel') returning id`,
    )
    return {
      clientId: clientRow.rows[0]?.id,
      startLocationId: start.rows[0]?.id,
      endLocationId: end.rows[0]?.id,
    }
  })

  const row = (
    clientId: string | undefined,
    startLocationId: string | undefined,
    endLocationId: string | undefined,
  ) => [
    clientId,
    '2026-10-06T18:00:00.000Z',
    startLocationId,
    endLocationId,
    1,
    'Ana Anić',
    null,
    '10.00',
    'cash',
    false,
    0,
    0,
    null,
  ]

  await expect(withTenant(tenantB, client =>
    client.query(transferInsert, row(foreign.clientId, own.startLocationId, own.endLocationId)))).rejects.toMatchObject({ code: '23503' })

  await expect(withTenant(tenantB, client =>
    client.query(transferInsert, row(own.clientId, foreign.startLocationId, own.endLocationId)))).rejects.toMatchObject({ code: '23503' })

  await expect(withTenant(tenantB, client =>
    client.query(transferInsert, row(own.clientId, own.startLocationId, foreign.endLocationId)))).rejects.toMatchObject({ code: '23503' })

  await expect(withTenant(tenantB, client =>
    client.query(
      `insert into app.rides (transfer_id, state) values ($1, 'unassigned')`,
      [foreign.transferId],
    ))).rejects.toMatchObject({ code: '23503' })
})
