import { defaultAc } from 'better-auth/plugins/organization/access'

/**
 * Seven days, in seconds, because Better Auth's invitationExpiresIn is seconds.
 * The email copy uses the day count so the two cannot drift.
 */
export const INVITATION_EXPIRES_DAYS = 7
export const invitationExpiresInSeconds = INVITATION_EXPIRES_DAYS * 24 * 60 * 60

/**
 * Only admin may invite. Dispatcher and driver are real roles with no
 * invitation permission, so Better Auth's own check returns 403.
 * Slice 2 adds member update and delete on admin.
 */
export const organizationRoles = {
  admin: defaultAc.newRole({
    invitation: ['create'],
  }),
  dispatcher: defaultAc.newRole({
    invitation: [],
  }),
  driver: defaultAc.newRole({
    invitation: [],
  }),
}
