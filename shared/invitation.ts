import { z } from 'zod'
import { tenantRoleSchema } from './tenant-role'

export const invitationPreviewSchema = z.object({
  state: z.enum(['set-password', 'sign-in', 'invalid']),
})

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
