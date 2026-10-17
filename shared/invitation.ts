import { z } from 'zod'
import { tenantRoleSchema } from './tenant-role'

/**
 * Length bounds from Better Auth's password config. The screen shows these
 * and names the bound a password misses. It does not invent a stricter rule.
 */
export interface PasswordLengthLimits {
  readonly minPasswordLength: number
  readonly maxPasswordLength: number
}

export function passwordLengthRule(password: string, limits: PasswordLengthLimits): 'too-short' | 'too-long' | null {
  if (password.length < limits.minPasswordLength)
    return 'too-short'
  if (password.length > limits.maxPasswordLength)
    return 'too-long'
  return null
}

export const invitationPreviewSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('set-password'),
    minPasswordLength: z.number().int().positive(),
    maxPasswordLength: z.number().int().positive(),
  }),
  z.object({
    state: z.literal('sign-in'),
  }),
  z.object({
    state: z.literal('invalid'),
  }),
  z.object({
    state: z.literal('wrong-account'),
    // The signed-in account, shown back to that person. Not the invite email.
    account: z.string().min(1),
  }),
])

export type InvitationPreview = z.infer<typeof invitationPreviewSchema>

export const inviteResultSchema = z.object({
  inviteUrl: z.url(),
  emailSent: z.boolean(),
})

export type InviteResult = z.infer<typeof inviteResultSchema>

export const inviteInputSchema = z.object({
  email: z.email(),
  role: tenantRoleSchema,
})

/**
 * GET /api/invitations. One pending, unexpired invitation.
 * The id is how the Admin revokes it. The email is shown on Članovi.
 * Accepted, expired, and revoked rows are not in this list.
 */
export const pendingInvitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: tenantRoleSchema,
  expiresAt: z.iso.datetime(),
})

export type PendingInvitation = z.infer<typeof pendingInvitationSchema>

export const pendingInvitationListSchema = z.object({
  invitations: z.array(pendingInvitationSchema),
})

export type PendingInvitationList = z.infer<typeof pendingInvitationListSchema>

/** POST /api/invitations/:invitationId/revoke. A uuid; anything else is 400. */
export const invitationIdSchema = z.uuid()

/** POST /api/invitations/preview. A bad id is a 400, not a preview state. */
export const invitationPreviewBodySchema = z.object({
  invitationId: z.uuid(),
})

/**
 * POST /api/invitations/accept.
 * Name and password arrive together for a new account. An existing account
 * sends only the id. Any other shape is a 400. Unknown fields are dropped,
 * so a caller cannot choose the email.
 */
export const invitationAcceptBodySchema = z.object({
  invitationId: z.uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(1).optional(),
}).superRefine((body, ctx) => {
  if ((body.name === undefined) !== (body.password === undefined)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Name and password are required together.',
    })
  }
})

/**
 * Status codes from POST /api/invitations/accept.
 * 422 is the password rule. 409 means the email already has an account.
 * 429 is the same limit as email sign-in. The body message stays generic.
 */
export function acceptErrorKey(status: number): 'acceptInvite.passwordRules' | 'acceptInvite.limited' | 'acceptInvite.signInTitle' | 'acceptInvite.failed' {
  if (status === 422)
    return 'acceptInvite.passwordRules'
  if (status === 429)
    return 'acceptInvite.limited'
  if (status === 409)
    return 'acceptInvite.signInTitle'
  return 'acceptInvite.failed'
}
