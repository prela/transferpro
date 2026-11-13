import type { IsoCountry, OperatingAreaCircle, OperatingAreaField } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { OperatingAreaCommand } from './operating-area-args'
import { sql } from 'drizzle-orm'
import pg from 'pg'
import { z } from 'zod'
import { auditFactSchema, isoCountrySchema, OPERATING_AREA_FIELDS } from '../../../../shared'
import { OPERATING_AREA_OUT_OF_BOUNDS, operatingAreaCommandSchema, OperatingAreaError } from './operating-area-args'
import { TenantSettingsMissingError } from './tenant-settings'

/**
 * The platform owner sets one operating area and the Tenant's country.
 * The connection is transferpro_owner. That role bypasses row-level security,
 * so every write names the Tenant explicitly, the same way provisioning
 * writes the settings row (ADR-0063).
 */
const OPERATOR_ACTOR = 'transferpro_owner'

const roleRow = z.object({ role: z.string() })

export interface SetOperatingAreaInput {
  readonly migrateDatabaseUrl: string
  readonly command: OperatingAreaCommand
}

export interface SuggestionBias {
  readonly area: OperatingAreaCircle | null
  readonly country: IsoCountry | null
}

const biasRow = z.object({
  country_code: isoCountrySchema.nullable(),
  center_lat: z.string().nullable(),
  center_lng: z.string().nullable(),
  radius_m: z.union([z.number(), z.string().regex(/^\d+$/)]).nullable(),
})

/**
 * The session Tenant's active area and country.
 * An archived area is none. A missing country is none.
 * The caller already holds the tenant transaction, so another Tenant's row
 * cannot be read here. The office allow-list is enforced by that caller,
 * the same way the Tenant's default language is read.
 */
export async function loadSuggestionBias(transaction: TenantTransaction): Promise<SuggestionBias> {
  const selected = z.object({ rows: z.array(biasRow) }).parse(await transaction.execute(sql`
    select settings.country_code,
           area.center_lat::text as center_lat,
           area.center_lng::text as center_lng,
           area.radius_m
    from app.tenant_settings as settings
    left join app.operating_area as area
      on area.tenant_id = settings.tenant_id
     and area.archived_at is null
  `))
  if (selected.rows.length !== 1)
    throw new TenantSettingsMissingError()
  const row = selected.rows[0]
  if (row === undefined)
    throw new TenantSettingsMissingError()
  const areaMissing = row.center_lat === null && row.center_lng === null && row.radius_m === null
  if (!areaMissing && (row.center_lat === null || row.center_lng === null || row.radius_m === null))
    throw new Error('Operating area read failed')
  return {
    area: areaMissing
      ? null
      : {
          latitude: Number(row.center_lat),
          longitude: Number(row.center_lng),
          radiusM: Number(row.radius_m),
        },
    country: row.country_code,
  }
}

/**
 * Insert, update in place, or archive. The same values write nothing.
 * An unknown slug or a value outside the table's bounds exits through
 * {@link OperatingAreaError} with a fixed sentence.
 */
export async function setOperatingArea(input: SetOperatingAreaInput): Promise<'changed' | 'unchanged'> {
  if (!z.url().safeParse(input.migrateDatabaseUrl).success)
    throw new OperatingAreaError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role (.env.migrate).')
  const command = operatingAreaCommandSchema.safeParse(input.command)
  if (!command.success)
    throw new OperatingAreaError(OPERATING_AREA_OUT_OF_BOUNDS)

  const pool = new pg.Pool({ connectionString: input.migrateDatabaseUrl, max: 1 })
  try {
    await assertOwner(pool)
    const client = await pool.connect()
    try {
      await client.query('begin')
      const organization = await client.query<{ id: string }>(
        'select id from auth.organization where slug = $1',
        [command.data.slug],
      )
      const tenantId = organization.rows[0]?.id
      if (!tenantId)
        throw new OperatingAreaError('No tenant matches that slug.')
      await client.query(`select set_config('app.tenant_id', $1, true)`, [tenantId])
      const changed = await apply(client, tenantId, command.data)
      await client.query('commit')
      return changed ? 'changed' : 'unchanged'
    }
    catch (error) {
      await client.query('rollback')
      throw storedFailure(error)
    }
    finally {
      client.release()
    }
  }
  finally {
    await pool.end()
  }
}

async function apply(client: pg.PoolClient, tenantId: string, command: OperatingAreaCommand): Promise<boolean> {
  if (command.mode === 'archive')
    return archiveArea(client, tenantId)
  if (command.mode === 'country')
    return setCountry(client, tenantId, command.country)
  const areaChanged = await upsertArea(client, tenantId, command)
  const countryChanged = command.country === undefined
    ? false
    : await setCountry(client, tenantId, command.country)
  return areaChanged || countryChanged
}

async function upsertArea(
  client: pg.PoolClient,
  tenantId: string,
  command: Extract<OperatingAreaCommand, { mode: 'area' }>,
): Promise<boolean> {
  const existing = await client.query<{
    id: string
    name: string
    same_lat: boolean
    same_lng: boolean
    same_radius: boolean
  }>(
    `select id, name,
            center_lat = $2::numeric as same_lat,
            center_lng = $3::numeric as same_lng,
            radius_m = $4 as same_radius
     from app.operating_area
     where tenant_id = $1 and archived_at is null`,
    [tenantId, command.latitude, command.longitude, command.radiusM],
  )
  if (existing.rows.length > 1)
    throw new OperatingAreaError('Could not update the operating area.')
  const row = existing.rows[0]
  if (row === undefined) {
    await client.query(
      `insert into app.operating_area (tenant_id, name, center_lat, center_lng, radius_m)
       values ($1, $2, $3::numeric, $4::numeric, $5)`,
      [tenantId, command.name, command.latitude, command.longitude, command.radiusM],
    )
    await append(client, 'settings.operating_area_set', { fields: [...OPERATING_AREA_FIELDS] })
    return true
  }
  const changed = row.name !== command.name || !row.same_lat || !row.same_lng || !row.same_radius
  if (!changed)
    return false
  const updated = await client.query(
    `update app.operating_area
     set name = $2, center_lat = $3::numeric, center_lng = $4::numeric, radius_m = $5
     where id = $1 and tenant_id = $6 and archived_at is null`,
    [row.id, command.name, command.latitude, command.longitude, command.radiusM, tenantId],
  )
  if ((updated.rowCount ?? 0) !== 1)
    throw new OperatingAreaError('Could not update the operating area.')
  await append(client, 'settings.operating_area_set', { fields: [...OPERATING_AREA_FIELDS] })
  return true
}

async function setCountry(client: pg.PoolClient, tenantId: string, country: IsoCountry): Promise<boolean> {
  const current = await client.query<{ country_code: string | null }>(
    'select country_code from app.tenant_settings where tenant_id = $1',
    [tenantId],
  )
  if (current.rows.length !== 1)
    throw new OperatingAreaError('Could not update the operating area.')
  const from = current.rows[0]?.country_code ?? null
  if (from === country)
    return false
  const updated = await client.query(
    'update app.tenant_settings set country_code = $1 where tenant_id = $2',
    [country, tenantId],
  )
  if ((updated.rowCount ?? 0) !== 1)
    throw new OperatingAreaError('Could not update the operating area.')
  await append(client, 'settings.country_changed', { from, to: country })
  return true
}

async function archiveArea(client: pg.PoolClient, tenantId: string): Promise<boolean> {
  const archived = await client.query(
    `update app.operating_area
     set archived_at = now()
     where tenant_id = $1 and archived_at is null`,
    [tenantId],
  )
  if ((archived.rowCount ?? 0) === 0)
    return false
  if ((archived.rowCount ?? 0) !== 1)
    throw new OperatingAreaError('Could not update the operating area.')
  await append(client, 'settings.operating_area_archived', { fields: [...OPERATING_AREA_FIELDS] })
  return true
}

async function append(
  client: pg.PoolClient,
  action: 'settings.operating_area_set' | 'settings.operating_area_archived' | 'settings.country_changed',
  data: { fields: readonly OperatingAreaField[] } | { from: string | null, to: string },
): Promise<void> {
  const entry = auditFactSchema.parse({
    action,
    subjectUserId: null,
    data,
  })
  await client.query(
    'select audit.append_entry($1, $2, $3, $4::jsonb)',
    [entry.action, OPERATOR_ACTOR, entry.subjectUserId, JSON.stringify(entry.data)],
  )
}

async function assertOwner(pool: pg.Pool): Promise<void> {
  const result = await pool.query('select current_user as role')
  const role = roleRow.parse(result.rows[0]).role
  if (role !== 'transferpro_owner')
    throw new OperatingAreaError(`This connection is ${role}. It must be transferpro_owner.`)
}

function storedFailure(error: unknown): OperatingAreaError {
  if (error instanceof OperatingAreaError)
    return error
  return new OperatingAreaError('Could not update the operating area.')
}
