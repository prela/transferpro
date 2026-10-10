import { z } from 'zod'
import { displayLocaleSchema } from './display-locale'
import { tenantRoleSchema } from './tenant-role'
import { operationalDayStartHourSchema } from './tenant-settings'

/**
 * What the signed-in shell reads from GET /api/session.
 * tenantId is the session proof. The role decides whether the invite form shows.
 * userId is needed to identify the current user in the member list.
 * The time zone and the operational-day start are how the board names a day.
 */
export const sessionShellSchema = z.object({
  tenantId: z.uuid(),
  tenantName: z.string().min(1),
  userId: z.string().min(1),
  locale: displayLocaleSchema,
  timeZone: z.string().min(1),
  operationalDayStartHour: operationalDayStartHourSchema,
  role: tenantRoleSchema,
})

export type SessionShell = z.infer<typeof sessionShellSchema>
