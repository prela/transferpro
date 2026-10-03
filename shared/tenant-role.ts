import { z } from 'zod'

/** The only Tenant roles. Better Auth's owner and member are not used. */
export const tenantRoleSchema = z.enum(['admin', 'dispatcher', 'driver'])

export type TenantRole = z.infer<typeof tenantRoleSchema>
