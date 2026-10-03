import { z } from 'zod'
import { displayLocaleSchema } from './display-locale'
import { tenantRoleSchema } from './tenant-role'

/**
 * What the signed-in shell reads from GET /api/session.
 * tenantId is the session proof. The role decides whether the invite form shows.
 * The other fields are display.
 */
export const sessionShellSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string().min(1),
  locale: displayLocaleSchema,
  timeZone: z.string().min(1),
  role: tenantRoleSchema,
})

export type SessionShell = z.infer<typeof sessionShellSchema>
