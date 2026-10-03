import type { TenantRole } from '../../../../shared'
import type { AuthHandle } from './auth'
import { changeMemberRoleBodySchema, memberErrorMessage } from '../../../../shared'

/**
 * Fixed error phrases for member operations.
 * No member email, session token, or user id in logs or error messages.
 */
const STATUS_CODE: Record<MemberStatusCode, MemberStatusCode> = {
  400: 400,
  401: 401,
  403: 403,
  404: 404,
  409: 409,
  500: 500,
}

type MemberStatusCode = 400 | 401 | 403 | 404 | 409 | 500

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
    case 400:
      return memberErrorMessage('member.failed')
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
    throw new MemberAccessError(STATUS_CODE[400])
  return parsed.data
}

/**
 * Change a member's role. Admin-only (enforced by Better Auth role check).
 * The last admin cannot be demoted to dispatcher or driver.
 * Authorization is checked first, before any existence or last-admin checks.
 * Uses pg_advisory_xact_lock to prevent race conditions in concurrent role changes.
 */
export async function changeMemberRole(
  handle: AuthHandle,
  headers: Headers,
  organizationId: string,
  targetUserId: string,
  newRole: TenantRole,
): Promise<void> {
  // Verify caller is admin by attempting to get their session and checking membership
  const session = await handle.auth.api.getSession({ headers })
  if (!session)
    throw new MemberAccessError(STATUS_CODE[401])

  const memberships = await handle.memberships(session.user.id)
  const callerMembership = memberships.find(m => m.organizationId === organizationId)
  if (!callerMembership || callerMembership.role !== 'admin')
    throw new MemberAccessError(STATUS_CODE[403])

  // Self-protection: admin cannot change their own role
  if (targetUserId === session.user.id)
    throw new MemberAccessError(STATUS_CODE[409], 'Cannot change your own role.')

  // Use advisory lock and SQL transaction to prevent race conditions
  const client = await handle.authPool.connect()
  try {
    await client.query('begin')

    // Lock on organization to serialize role changes
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [organizationId])

    // Find the member id and current role
    const memberResult = await client.query(
      `select id, role from auth.member where organization_id = $1 and user_id = $2`,
      [organizationId, targetUserId],
    )
    if (memberResult.rows.length === 0) {
      await client.query('rollback')
      throw new MemberAccessError(STATUS_CODE[404])
    }

    const memberId = memberResult.rows[0].id as string
    const currentRole = memberResult.rows[0].role as string

    // If demoting an admin, recount and ensure at least one remains
    if (currentRole === 'admin' && newRole !== 'admin') {
      const countResult = await client.query(
        `select count(*) as admin_count from auth.member
         where organization_id = $1 and role = 'admin' and user_id != $2`,
        [organizationId, targetUserId],
      )
      const remainingAdmins = Number.parseInt(countResult.rows[0].admin_count as string, 10)
      if (remainingAdmins === 0) {
        await client.query('rollback')
        throw new MemberAccessError(STATUS_CODE[409], memberErrorMessage('member.lastAdmin'))
      }
    }

    // Update the role
    await client.query(
      `update auth.member set role = $1 where id = $2`,
      [newRole, memberId],
    )

    await client.query('commit')
  }
  catch (error) {
    await client.query('rollback')
    if (error instanceof MemberAccessError)
      throw error
    throw new MemberAccessError(STATUS_CODE[500])
  }
  finally {
    client.release()
  }
}

/**
 * Remove a member from the organization. Admin-only (enforced by Better Auth).
 * The last admin cannot be removed. All sessions for that user in this
 * organization are revoked immediately.
 * Authorization is checked first, before any existence or last-admin checks.
 * Uses pg_advisory_xact_lock to prevent race conditions in concurrent removals.
 */
export async function removeMember(
  handle: AuthHandle,
  headers: Headers,
  organizationId: string,
  targetUserId: string,
): Promise<void> {
  // Verify caller is admin by attempting to get their session and checking membership
  const session = await handle.auth.api.getSession({ headers })
  if (!session)
    throw new MemberAccessError(STATUS_CODE[401])

  const memberships = await handle.memberships(session.user.id)
  const callerMembership = memberships.find(m => m.organizationId === organizationId)
  if (!callerMembership || callerMembership.role !== 'admin')
    throw new MemberAccessError(STATUS_CODE[403])

  // Self-protection: admin cannot remove themselves
  if (targetUserId === session.user.id)
    throw new MemberAccessError(STATUS_CODE[409], 'Cannot remove yourself.')

  // Use advisory lock and SQL transaction to prevent race conditions
  const client = await handle.authPool.connect()
  try {
    await client.query('begin')

    // Lock on organization to serialize member removals
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [organizationId])

    // Find the member and check role
    const memberResult = await client.query(
      `select id, role from auth.member where organization_id = $1 and user_id = $2`,
      [organizationId, targetUserId],
    )
    if (memberResult.rows.length === 0) {
      await client.query('rollback')
      throw new MemberAccessError(STATUS_CODE[404])
    }

    const memberId = memberResult.rows[0].id as string
    const role = memberResult.rows[0].role as string

    // If removing an admin, recount and ensure at least one remains
    if (role === 'admin') {
      const countResult = await client.query(
        `select count(*) as admin_count from auth.member
         where organization_id = $1 and role = 'admin' and user_id != $2`,
        [organizationId, targetUserId],
      )
      const remainingAdmins = Number.parseInt(countResult.rows[0].admin_count as string, 10)
      if (remainingAdmins === 0) {
        await client.query('rollback')
        throw new MemberAccessError(STATUS_CODE[409], memberErrorMessage('member.lastAdmin'))
      }
    }

    // Delete the member
    await client.query(
      `delete from auth.member where id = $1`,
      [memberId],
    )

    await client.query('commit')

    // Revoke sessions after successful commit
    await handle.revokeOrganizationSessions(targetUserId, organizationId)
  }
  catch (error) {
    await client.query('rollback')
    if (error instanceof MemberAccessError)
      throw error
    throw new MemberAccessError(STATUS_CODE[500])
  }
  finally {
    client.release()
  }
}
