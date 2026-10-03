import type { TenantRole } from '../../../../shared'
import type { AuthHandle } from './auth'
import { changeMemberRoleBodySchema, memberErrorMessage } from '../../../../shared'

/**
 * Fixed error phrases for member operations.
 * No member email, session token, or user id in logs or error messages.
 */
const STATUS_CODE: Record<MemberStatusCode, MemberStatusCode> = {
  401: 401,
  403: 403,
  404: 404,
  409: 409,
  500: 500,
}

type MemberStatusCode = 401 | 403 | 404 | 409 | 500

export class MemberAccessError extends Error {
  readonly statusCode: MemberStatusCode

  constructor(statusCode: MemberStatusCode, message?: string) {
    super(message ?? statusCodeMessage(statusCode))
    this.name = 'MemberAccessError'
    this.statusCode = statusCode
  }
}

function statusCodeMessage(statusCode: MemberStatusCode): string {
  switch (statusCode) {
    case 401:
      return memberErrorMessage('member.unauthorized')
    case 403:
      return memberErrorMessage('member.forbidden')
    case 404:
      return memberErrorMessage('member.notFound')
    case 409:
      return memberErrorMessage('member.lastAdmin')
    case 500:
      return memberErrorMessage('member.failed')
  }
}

export function parseChangeMemberRole(raw: unknown): { role: TenantRole } {
  const parsed = changeMemberRoleBodySchema.safeParse(raw)
  if (!parsed.success)
    throw new MemberAccessError(400 as MemberStatusCode)
  return parsed.data
}

/**
 * Change a member's role. Admin-only (enforced by Better Auth role check).
 * The last admin cannot be demoted to dispatcher or driver.
 */
export async function changeMemberRole(
  handle: AuthHandle,
  headers: Headers,
  organizationId: string,
  targetUserId: string,
  newRole: TenantRole,
): Promise<void> {
  // Check if this would demote the last admin
  if (newRole !== 'admin') {
    const remainingAdmins = await countAdminsExcept(handle, organizationId, targetUserId)
    if (remainingAdmins === 0)
      throw new MemberAccessError(STATUS_CODE[409], memberErrorMessage('member.lastAdmin'))
  }

  try {
    // Find the member id for this user in this organization
    const memberId = await getMemberId(handle, organizationId, targetUserId)
    if (!memberId)
      throw new MemberAccessError(STATUS_CODE[404])

    // Server API, not auth.handler, to avoid hitting the HTTP rate limiter
    await handle.auth.api.updateMemberRole({
      body: {
        memberId,
        role: newRole,
        organizationId,
      },
      headers,
    })
  }
  catch (error) {
    if (error instanceof MemberAccessError)
      throw error
    const status = getStatusCode(error)
    if (status === 403)
      throw new MemberAccessError(STATUS_CODE[403])
    if (status === 401)
      throw new MemberAccessError(STATUS_CODE[401])
    throw new MemberAccessError(STATUS_CODE[500])
  }
}

/**
 * Remove a member from the organization. Admin-only (enforced by Better Auth).
 * The last admin cannot be removed. All sessions for that user in this
 * organization are revoked immediately.
 */
export async function removeMember(
  handle: AuthHandle,
  headers: Headers,
  organizationId: string,
  targetUserId: string,
): Promise<void> {
  // Check if this would remove the last admin
  const memberships = await handle.memberships(targetUserId)
  const membership = memberships.find(m => m.organizationId === organizationId)
  if (!membership)
    throw new MemberAccessError(STATUS_CODE[404])

  if (membership.role === 'admin') {
    const remainingAdmins = await countAdminsExcept(handle, organizationId, targetUserId)
    if (remainingAdmins === 0)
      throw new MemberAccessError(STATUS_CODE[409], memberErrorMessage('member.lastAdmin'))
  }

  try {
    // Server API, not auth.handler, to avoid hitting the HTTP rate limiter
    await handle.auth.api.removeMember({
      body: {
        memberIdOrEmail: targetUserId,
        organizationId,
      },
      headers,
    })

    // Revoke all sessions for this user in this organization
    await handle.revokeOrganizationSessions(targetUserId, organizationId)
  }
  catch (error) {
    if (error instanceof MemberAccessError)
      throw error
    const status = getStatusCode(error)
    if (status === 403)
      throw new MemberAccessError(STATUS_CODE[403])
    if (status === 401)
      throw new MemberAccessError(STATUS_CODE[401])
    throw new MemberAccessError(STATUS_CODE[500])
  }
}

/**
 * Count how many admins remain in an organization, excluding one specific user.
 * Used to prevent removing or demoting the last admin.
 */
async function countAdminsExcept(
  handle: AuthHandle,
  organizationId: string,
  excludeUserId: string,
): Promise<number> {
  return handle.countAdminsExcept(organizationId, excludeUserId)
}

/**
 * Find the member id for a user in an organization.
 * Better Auth's updateMemberRole needs the member id, not the user id.
 */
async function getMemberId(
  handle: AuthHandle,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const result = await handle.getMemberId(organizationId, userId)
  return result
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = error.statusCode
    if (typeof code === 'number')
      return code
  }
  return undefined
}
