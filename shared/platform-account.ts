import { z } from 'zod'
import { TENANT_NAME_MAX_LENGTH, tenantNameSchema } from './tenant-name'

/**
 * Eight hours, from the moment the session row is created.
 * A Tenant member keeps Better Auth's seven-day session.
 * The database trigger uses the same eight hours (`interval '8 hours'`).
 * There is no second factor for a superadmin in v1 (ADR-0019).
 */
export const SUPERADMIN_SESSION_SECONDS = 8 * 60 * 60

/**
 * The signed-in platform owner. This is not a TenantContext:
 * it has no tenantId, and it cannot open a tenant session.
 */
export interface PlatformActor {
  readonly userId: string
}

/**
 * What opening a firm is allowed to show.
 * Clients, drivers, vehicles, rides, members, and the audit log are not fields.
 */
export const companyAccountSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
  createdAt: z.iso.datetime(),
  active: z.boolean(),
})

export type CompanyAccount = z.infer<typeof companyAccountSchema>

/**
 * One screen of firms. The client cannot ask for a larger page:
 * the whole directory is what made `/admin/tenants` fail to paint.
 */
export const PLATFORM_TENANT_PAGE_SIZE = 20

export const companyAccountListSchema = z.strictObject({
  accounts: z.array(companyAccountSchema),
  page: z.number().int().min(1),
  pageSize: z.literal(PLATFORM_TENANT_PAGE_SIZE),
  total: z.number().int().nonnegative(),
})

export type CompanyAccountList = z.infer<typeof companyAccountListSchema>

/**
 * `page` is 1-based and at most four digits. `q` matches a name or a slug.
 * An unknown key is refused so an email cannot ride along. The value is
 * trimmed and never echoed in the error.
 */
const platformTenantListQuerySchema = z.strictObject({
  page: z.string().regex(/^[1-9]\d{0,3}$/).optional(),
  q: z.string().trim().max(TENANT_NAME_MAX_LENGTH).optional(),
})

export function parsePlatformTenantListQuery(raw: unknown): { page: number, q: string } {
  const parsed = platformTenantListQuerySchema.safeParse(raw)
  if (!parsed.success)
    throw new PlatformInputError()
  return {
    page: parsed.data.page === undefined ? 1 : Number(parsed.data.page),
    q: parsed.data.q ?? '',
  }
}

/** `{ name }` only. An unknown key is refused so a slug cannot ride along. */
export const renameTenantAccountSchema = z.strictObject({
  name: tenantNameSchema,
})

export function parseRenameTenantAccount(raw: unknown): { name: string } {
  const parsed = renameTenantAccountSchema.safeParse(raw)
  if (!parsed.success)
    throw new PlatformInputError()
  return parsed.data
}

/**
 * The platform shell. `timeZone` is the literal default, not a row
 * from `app.tenant_settings`. A null user locale becomes `hr`.
 */
export const platformShellSchema = z.strictObject({
  userId: z.string().min(1),
  // The signed-in account only, for the profile menu. Not a firm field.
  userName: z.string().min(1),
  email: z.string().min(1),
  locale: z.enum(['hr', 'en']),
  timeZone: z.literal('Europe/Zagreb'),
})

export type PlatformShell = z.infer<typeof platformShellSchema>

/** A bad rename body. The message is fixed and does not echo the body. */
export class PlatformInputError extends Error {
  readonly statusCode = 400 as const

  constructor() {
    super('Bad Request')
    this.name = 'PlatformInputError'
  }
}
