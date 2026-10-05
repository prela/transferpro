import type { CompanyAccount, CompanyAccountList, PlatformActor, PlatformShell } from '../../../../shared'
import type { PlatformLogEvent } from './log'
import pg from 'pg'
import { z } from 'zod'
import { companyAccountListSchema, companyAccountSchema, parseRenameTenantAccount, PlatformInputError, platformShellSchema, resolveDisplayLocale, TENANT_TIME_ZONE_DEFAULT } from '../../../../shared'
import { getLogger, loadAppEnv } from '../../../core/index'
import { platformActorFromSession, readUserLocale, TenantAccessError } from '../../tenancy'
import { appendTenantRenamed } from './audit'
import { writePlatformLog } from './log'

/**
 * 400 and 404 for a superadmin, after the gate.
 * 401 and 403 stay TenantAccessError, raised before this id is looked up.
 */
export class PlatformAccessError extends Error {
  readonly statusCode: 400 | 404
  readonly userId: string

  constructor(statusCode: 400 | 404, userId: string) {
    super(statusCode === 400 ? 'Bad Request' : 'Not Found')
    this.name = 'PlatformAccessError'
    this.statusCode = statusCode
    this.userId = userId
  }
}

const accountRow = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  created_at: z.string(),
  active: z.boolean(),
})

/**
 * The only columns this role may read. `active` is the absence of a
 * suspension row. Nothing in schema app is named here.
 */
const accountSql = `
  select organization.id,
         organization.name,
         organization.slug,
         to_char(organization.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
         not exists (
           select account.organization_id
           from platform.tenant_account as account
           where account.organization_id = organization.id
         ) as active
  from auth.organization as organization
`

let pool: pg.Pool | undefined

function platformPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: loadAppEnv().PLATFORM_DATABASE_URL })
  return pool
}

/** Tests close this. The server keeps it. */
export async function closePlatformRuntime(): Promise<void> {
  const current = pool
  pool = undefined
  if (current)
    await current.end()
}

export async function readPlatformShell(headers: Headers): Promise<PlatformShell> {
  return platformCall(headers, 'platform.session', null, async (actor) => {
    // The user's own locale. The tenant default is the literal hr, not a settings row.
    const locale = resolveDisplayLocale(await readUserLocale(actor.userId), 'hr')
    return platformShellSchema.parse({
      userId: actor.userId,
      locale,
      timeZone: TENANT_TIME_ZONE_DEFAULT,
    })
  })
}

export async function listTenantAccounts(headers: Headers): Promise<CompanyAccountList> {
  return platformCall(headers, 'platform.tenants.list', null, async () => {
    const result = await platformPool().query(
      `${accountSql} order by organization.name, organization.slug`,
    )
    const accounts = result.rows.map(row => toAccount(row))
    return companyAccountListSchema.parse({ accounts })
  })
}

export async function readTenantAccount(headers: Headers, rawId: string): Promise<CompanyAccount> {
  return platformCall(headers, 'platform.tenants.open', rawId, async (actor) => {
    const id = parseOrganizationId(rawId, actor)
    const result = await platformPool().query(`${accountSql} where organization.id = $1`, [id])
    const row = result.rows[0]
    if (!row)
      throw new PlatformAccessError(404, actor.userId)
    return toAccount(row)
  })
}

export async function renameTenantAccount(headers: Headers, rawId: string, body: unknown): Promise<CompanyAccount> {
  return platformCall(headers, 'platform.tenants.rename', rawId, async (actor) => {
    const id = parseOrganizationId(rawId, actor)
    let name: string
    try {
      name = parseRenameTenantAccount(body).name
    }
    catch (error) {
      if (error instanceof PlatformInputError)
        throw new PlatformAccessError(400, actor.userId)
      throw error
    }
    const client = await platformPool().connect()
    try {
      await client.query('begin')
      const current = await client.query(`${accountSql} where organization.id = $1`, [id])
      const row = current.rows[0]
      if (!row)
        throw new PlatformAccessError(404, actor.userId)
      const account = toAccount(row)
      // Same name: no write and no audit row.
      if (account.name === name) {
        await client.query('commit')
        return account
      }
      const updated = await client.query(
        'update auth.organization set name = $2 where id = $1',
        [id, name],
      )
      if ((updated.rowCount ?? 0) !== 1)
        throw new PlatformAccessError(404, actor.userId)
      // Transaction-local. The connection returns to the pool only after commit or rollback.
      await client.query(`select set_config('app.tenant_id', $1, true)`, [id])
      await appendTenantRenamed(client, actor.userId)
      await client.query('commit')
      return companyAccountSchema.parse({ ...account, name })
    }
    catch (error) {
      await client.query('rollback')
      throw error
    }
    finally {
      client.release()
    }
  })
}

/**
 * The gate runs before `run`, so a tenant admin never reaches the id query.
 * A non-uuid is still logged without being treated as a tenant id.
 */
async function platformCall<T>(
  headers: Headers,
  action: PlatformLogEvent['action'],
  rawTarget: string | null,
  run: (actor: PlatformActor) => Promise<T>,
): Promise<T> {
  const targetTenantId = rawTarget !== null && z.uuid().safeParse(rawTarget).success ? rawTarget : null
  let userId: string | null = null
  try {
    const actor = await platformActorFromSession(headers)
    userId = actor.userId
    const result = await run(actor)
    writePlatformLog(getLogger(), { userId, action, targetTenantId, outcome: 'ok' })
    return result
  }
  catch (error) {
    writePlatformLog(getLogger(), {
      userId: userId ?? (error instanceof TenantAccessError ? error.userId ?? null : null),
      action,
      targetTenantId,
      outcome: outcomeOf(error),
    })
    throw error
  }
}

function parseOrganizationId(rawId: string, actor: PlatformActor): string {
  const parsed = z.uuid().safeParse(rawId)
  if (!parsed.success)
    throw new PlatformAccessError(400, actor.userId)
  return parsed.data
}

function toAccount(row: unknown): CompanyAccount {
  const parsed = accountRow.parse(row)
  return companyAccountSchema.parse({
    id: parsed.id,
    name: parsed.name,
    slug: parsed.slug,
    createdAt: parsed.created_at,
    active: parsed.active,
  })
}

function outcomeOf(error: unknown): PlatformLogEvent['outcome'] {
  if (error instanceof TenantAccessError)
    return error.statusCode === 401 ? 'unauthorized' : 'forbidden'
  if (error instanceof PlatformAccessError)
    return error.statusCode === 404 ? 'not_found' : 'bad_request'
  if (error instanceof PlatformInputError)
    return 'bad_request'
  return 'error'
}
