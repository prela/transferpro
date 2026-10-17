import { z } from 'zod'
import { tenantRoleSchema } from './tenant-role'

/**
 * List of members visible to the current Tenant session.
 * The sign-in address is only on an Admin read, for the Članovi table.
 * A Dispatcher list (the Drivers catalog) does not include it.
 * The app view still hides it; the auth role reads it for ids that view already returned.
 */
export const memberSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  email: z.email().optional(),
  role: tenantRoleSchema,
})

export type Member = z.infer<typeof memberSchema>

export const memberListSchema = z.object({
  members: z.array(memberSchema),
})

export type MemberList = z.infer<typeof memberListSchema>

/**
 * PATCH /api/members/:userId/role
 * Change a member's role. Admin-only. The role is one of admin, dispatcher, driver.
 */
export const changeMemberRoleBodySchema = z.object({
  role: tenantRoleSchema,
})

export type ChangeMemberRoleBody = z.infer<typeof changeMemberRoleBodySchema>

/**
 * Fixed error messages. No member email, session token, or user id in logs.
 */
export const memberErrorKey = z.enum([
  'member.unauthorized',
  'member.forbidden',
  'member.notFound',
  'member.lastAdmin',
  'member.roleNotTenant',
  'member.failed',
])

export type MemberErrorKey = z.infer<typeof memberErrorKey>

export function memberErrorMessage(key: MemberErrorKey): string {
  switch (key) {
    case 'member.unauthorized':
      return 'Unauthorized'
    case 'member.forbidden':
      return 'Forbidden'
    case 'member.notFound':
      return 'Member not found.'
    case 'member.lastAdmin':
      return 'Cannot remove or demote the last admin.'
    case 'member.roleNotTenant':
      return 'Member role is not a Tenant role.'
    case 'member.failed':
      return 'Operation failed.'
  }
}
