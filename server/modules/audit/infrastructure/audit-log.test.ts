import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it, vi } from 'vitest'
import { appendAuditEntry, listAuditEntries } from './audit-log'

const adminId = '7c2f1d4b-3333-4333-8333-333333333333'
const memberId = '6b1e0c3a-2222-4222-8222-222222222222'
const dialect = new PgDialect()

function fakeTransaction(rows: unknown[] = []) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    execute: vi.fn(async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query))
      return { rows }
    }),
  }
  return { transaction, queries }
}

it('appends one entry with the action, the actor, the member, and the data, and no tenant id', async () => {
  const { transaction, queries } = fakeTransaction()
  await appendAuditEntry(transaction, {
    action: 'member.role_changed',
    actorUserId: adminId,
    subjectUserId: memberId,
    data: { from: 'driver', to: 'dispatcher' },
  })
  expect(queries).toHaveLength(1)
  // The Tenant is whatever the open session set; the caller cannot pass one.
  expect(queries[0]?.params).toEqual([
    'member.role_changed',
    adminId,
    memberId,
    JSON.stringify({ from: 'driver', to: 'dispatcher' }),
  ])
})

it('refuses an entry with an extra data key, no actor, or a missing member before the database sees it', async () => {
  const { transaction } = fakeTransaction()
  await expect(appendAuditEntry(transaction, {
    action: 'member.removed',
    actorUserId: adminId,
    subjectUserId: memberId,
    // @ts-expect-error the data object is strict
    data: { role: 'driver', email: 'ana@example.com' },
  })).rejects.toThrow()
  await expect(appendAuditEntry(transaction, {
    action: 'member.removed',
    actorUserId: '',
    subjectUserId: memberId,
    data: { role: 'driver' },
  })).rejects.toThrow()
  // @ts-expect-error a removal names the member
  await expect(appendAuditEntry(transaction, {
    action: 'member.removed',
    actorUserId: adminId,
    subjectUserId: null,
    data: { role: 'driver' },
  })).rejects.toThrow()
  expect(transaction.execute).not.toHaveBeenCalled()
})

it('lists rows newest first as the API shape, keeping a former member\'s name null', async () => {
  const { transaction } = fakeTransaction([
    {
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurred_at: '2026-10-03T18:43:00.000Z',
      action: 'member.removed',
      actor_user_id: adminId,
      actor_name: 'Ana Admin',
      subject_user_id: memberId,
      subject_name: null,
      data: { role: 'driver' },
    },
    {
      id: '9e4b3f6d-5555-4555-8555-555555555555',
      occurred_at: '2026-10-03T18:42:00.000Z',
      action: 'member.invited',
      actor_user_id: adminId,
      actor_name: 'Ana Admin',
      subject_user_id: null,
      subject_name: null,
      data: { role: 'dispatcher' },
    },
  ])
  expect(await listAuditEntries(transaction)).toEqual({
    entries: [
      {
        id: '8d3a2e5c-4444-4444-8444-444444444444',
        occurredAt: '2026-10-03T18:43:00.000Z',
        action: 'member.removed',
        actorUserId: adminId,
        actorName: 'Ana Admin',
        subjectUserId: memberId,
        subjectName: null,
        data: { role: 'driver' },
      },
      {
        id: '9e4b3f6d-5555-4555-8555-555555555555',
        occurredAt: '2026-10-03T18:42:00.000Z',
        action: 'member.invited',
        actorUserId: adminId,
        actorName: 'Ana Admin',
        subjectUserId: null,
        subjectName: null,
        data: { role: 'dispatcher' },
      },
    ],
  })
})

it('fails the read on a row whose data does not match its action', async () => {
  const { transaction } = fakeTransaction([{
    id: '8d3a2e5c-4444-4444-8444-444444444444',
    occurred_at: '2026-10-03T18:43:00.000Z',
    action: 'member.role_changed',
    actor_user_id: adminId,
    actor_name: 'Ana Admin',
    subject_user_id: memberId,
    subject_name: 'Dora Driver',
    data: { role: 'driver' },
  }])
  await expect(listAuditEntries(transaction)).rejects.toThrow()
})
