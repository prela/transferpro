import { expect, it } from 'vitest'
import { auditActions, auditEntryListSchema, auditFactSchema } from './audit-entry'

const memberId = '6b1e0c3a-2222-4222-8222-222222222222'
const adminId = '7c2f1d4b-3333-4333-8333-333333333333'

it('gives every audit action exactly one entry shape', () => {
  const shapes = auditFactSchema.options.map(option => option.shape.action.value)
  expect(shapes).toEqual([...auditActions])
})

it('records a role change as from and to, and refuses any other data key', () => {
  const change = { action: 'member.role_changed', subjectUserId: memberId, data: { from: 'driver', to: 'dispatcher' } }
  expect(auditFactSchema.parse(change)).toEqual(change)
  // An extra key is how an email or a name would slip into an append-only row.
  expect(auditFactSchema.safeParse({ ...change, data: { ...change.data, email: 'ana@example.com' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ ...change, data: { from: 'owner', to: 'driver' } }).success).toBe(false)
})

it('names no member on an invite and names the member on a removal', () => {
  expect(auditFactSchema.safeParse({ action: 'member.invited', subjectUserId: null, data: { role: 'driver' } }).success).toBe(true)
  expect(auditFactSchema.safeParse({ action: 'member.invited', subjectUserId: memberId, data: { role: 'driver' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ action: 'member.removed', subjectUserId: memberId, data: { role: 'admin' } }).success).toBe(true)
  expect(auditFactSchema.safeParse({ action: 'member.removed', subjectUserId: null, data: { role: 'admin' } }).success).toBe(false)
  expect(auditFactSchema.safeParse({ action: 'member.left', subjectUserId: memberId, data: {} }).success).toBe(false)
})

it('lists an entry whose people are no longer members with null names', () => {
  const listed = auditEntryListSchema.parse({
    entries: [{
      id: '8d3a2e5c-4444-4444-8444-444444444444',
      occurredAt: '2026-10-03T18:42:00.000Z',
      actorUserId: adminId,
      actorName: null,
      action: 'member.removed',
      subjectUserId: memberId,
      subjectName: null,
      data: { role: 'driver' },
    }],
  })
  expect(listed.entries[0]?.actorName).toBeNull()
  expect(auditEntryListSchema.safeParse({
    entries: [{ ...listed.entries[0], occurredAt: 'yesterday' }],
  }).success).toBe(false)
})
