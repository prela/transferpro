import { z } from 'zod'
import { displayLocaleSchema } from './display-locale'

/**
 * What the signed-in shell reads from GET /api/session.
 * tenantId is the session proof. The other fields are display.
 */
export const sessionShellSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string().min(1),
  locale: displayLocaleSchema,
  timeZone: z.string().min(1),
})

export type SessionShell = z.infer<typeof sessionShellSchema>
