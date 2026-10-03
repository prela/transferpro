import type pg from 'pg'
import type { TenantRole } from '../../../../shared'
import type { TenantTransaction } from '../../../core/index'
import type { AuthHandle } from './auth'
import type { Actor } from './session'
import { drizzle } from 'drizzle-orm/node-postgres'
import { z } from 'zod'
import { changeMemberRoleBodySchema, memberErrorMessage, tenantRoleSchema } from '../../../../shared'
import { openTenantSession } from '../../../core/index'
import { appendAuditEntry } from '../../audit'

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

const memberRow = z.object({ id: z.string(), role: z.string() })
const callerRow = z.object({ role: z.string() })
const adminCountRow = z.object({ admin_count: z.coerce.number().int() })

/**
 * Change a member's role. Admin of `organizationId` only.
 * An admin cannot change their own role; another admin must do it.
 * The last admin cannot be demoted to dispatcher or driver.
 * Authorization is checked first, before any existence or last-admin checks.
 * Uses pg_advisory_xact_lock to prevent race conditions in concurrent role changes.
 * The audit entry commits with the change, or neither does.
 */
export async function changeMemberRole(
  handle: AuthHandle,
  actor: Actor,
  organizationId: string,
  targetUserId: string,
  newRole: TenantRole,
): Promise<void> {
  assertAdminOf(actor, organizationId)
  // Self-protection: admin cannot change their own role
  if (targetUserId === actor.userId)
    throw new MemberAccessError(STATUS_CODE[409], 'Cannot change your own role.')

  await inLockedAdminTransaction(handle, actor, organizationId, async (client, transaction) => {
    const target = await selectMember(client, organizationId, targetUserId)
    // If demoting an admin, recount and ensure at least one remains
    if (target.role === 'admin' && newRole !== 'admin')
      await assertAnotherAdmin(client, organizationId, targetUserId)
    await client.query('update auth.member set role = $1 where id = $2', [newRole, target.id])
    await appendAuditEntry(transaction, {
      action: 'member.role_changed',
      actorUserId: actor.userId,
      subjectUserId: targetUserId,
      data: { from: target.role, to: newRole },
    })
  })
}

/**
 * Remove a member from the organization. Admin of `organizationId` only.
 * An admin cannot remove themselves. The last admin cannot be removed.
 * The member row and that user's sessions for this organization go in one
 * transaction, so a committed removal has no live session left behind.
 * Authorization is checked first, before any existence or last-admin checks.
 * Uses pg_advisory_xact_lock to prevent race conditions in concurrent removals.
 * The audit entry commits with the removal, or neither does.
 */
export async function removeMember(
  handle: AuthHandle,
  actor: Actor,
  organizationId: string,
  targetUserId: string,
): Promise<void> {
  assertAdminOf(actor, organizationId)
  // Self-protection: admin cannot remove themselves
  if (targetUserId === actor.userId)
    throw new MemberAccessError(STATUS_CODE[409], 'Cannot remove yourself.')

  await inLockedAdminTransaction(handle, actor, organizationId, async (client, transaction) => {
    const target = await selectMember(client, organizationId, targetUserId)
    // If removing an admin, recount and ensure at least one remains
    if (target.role === 'admin')
      await assertAnotherAdmin(client, organizationId, targetUserId)
    await client.query('delete from auth.member where id = $1', [target.id])
    // A fresh sign-in has no active organization, so a null one is this Tenant's too.
    await client.query(
      `delete from auth.session
       where user_id = $1 and (active_organization_id = $2 or active_organization_id is null)`,
      [targetUserId, organizationId],
    )
    await appendAuditEntry(transaction, {
      action: 'member.removed',
      actorUserId: actor.userId,
      subjectUserId: targetUserId,
      data: { role: target.role },
    })
  })
}

/**
 * 409 unless an admin other than `targetUserId` remains in the organization.
 * Run it under the advisory lock. Through changeMemberRole and removeMember
 * the caller was just re-read as such an admin, so this refuses only when a
 * writer has skipped that check.
 */
export async function assertAnotherAdmin(
  client: pg.PoolClient,
  organizationId: string,
  targetUserId: string,
): Promise<void> {
  const result = await client.query(
    `select count(*) as admin_count from auth.member
     where organization_id = $1 and role = 'admin' and user_id != $2`,
    [organizationId, targetUserId],
  )
  if (adminCountRow.parse(result.rows[0]).admin_count === 0)
    throw new MemberAccessError(STATUS_CODE[409], memberErrorMessage('member.lastAdmin'))
}

/** The actor is an admin of this organization, not of another Tenant. */
function assertAdminOf(actor: Actor, organizationId: string): void {
  if (actor.context.tenantId !== organizationId || actor.role !== 'admin')
    throw new MemberAccessError(STATUS_CODE[403])
}

async function selectMember(client: pg.PoolClient, organizationId: string, userId: string): Promise<{ id: string, role: TenantRole }> {
  const result = await client.query(
    'select id, role from auth.member where organization_id = $1 and user_id = $2',
    [organizationId, userId],
  )
  const row = memberRow.safeParse(result.rows[0])
  if (!row.success)
    throw new MemberAccessError(STATUS_CODE[404])
  // A stored role outside the Tenant roles cannot be logged (ADR-0014), so nothing is written.
  const role = tenantRoleSchema.safeParse(row.data.role)
  if (!role.success)
    throw new MemberAccessError(STATUS_CODE[409], memberErrorMessage('member.roleNotTenant'))
  return { id: row.data.id, role: role.data }
}

/**
 * One auth-pool transaction: lock the organization, re-read the caller's
 * role, run `work`, commit. The actor was read before the lock, so an admin
 * demoted or removed since then is 403 here. Every write the change needs,
 * session deletes and the audit entry included, belongs in `work`: nothing
 * may run after commit.
 *
 * The tenant session is opened on this auth connection, not on the app pool:
 * `audit.append_entry` reads the Tenant from `app.tenant_id`, and only one
 * connection can make the member write and its entry atomic (ADR-0014).
 * `actor.context` must name `organizationId`, so call `assertAdminOf` first.
 */
async function inLockedAdminTransaction(
  handle: AuthHandle,
  actor: Actor,
  organizationId: string,
  work: (client: pg.PoolClient, transaction: TenantTransaction) => Promise<void>,
): Promise<void> {
  const client = await handle.authPool.connect()
  try {
    await client.query('begin')
    try {
      const transaction = drizzle(client)
      await openTenantSession(transaction, actor.context, async () => {
        // Lock on organization to serialize role changes and removals
        await client.query('select pg_advisory_xact_lock(hashtext($1))', [organizationId])
        const caller = callerRow.safeParse((await client.query(
          'select role from auth.member where organization_id = $1 and user_id = $2',
          [organizationId, actor.userId],
        )).rows[0])
        if (!caller.success || caller.data.role !== 'admin')
          throw new MemberAccessError(STATUS_CODE[403])
        await work(client, transaction)
      })
    }
    catch (error) {
      await client.query('rollback')
      throw error
    }
    await client.query('commit')
  }
  catch (error) {
    if (error instanceof MemberAccessError)
      throw error
    throw new MemberAccessError(STATUS_CODE[500])
  }
  finally {
    client.release()
  }
}
