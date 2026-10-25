import { z } from 'zod'
import { tenantRoleSchema } from './tenant-role'

/**
 * One company on the gate. The name and the role are the choice.
 * Rides, Clients, and settings are not part of it.
 */
export const tenantChoiceSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string().min(1),
  role: tenantRoleSchema,
})

export const tenantChoiceListSchema = z.object({
  choices: z.array(tenantChoiceSchema),
})

/** The body of the choice. The session user is the only member who can set it. */
export const chooseTenantBodySchema = z.object({
  tenantId: z.uuid(),
})

export type TenantChoice = z.infer<typeof tenantChoiceSchema>
export type TenantChoiceList = z.infer<typeof tenantChoiceListSchema>
