import { expect, it } from 'vitest'
import { companyAccountListSchema, companyAccountSchema, parseRenameTenantAccount, PlatformInputError, platformShellSchema, SUPERADMIN_SESSION_SECONDS } from './index'

const account = {
  id: '6b1e0c3a-2222-4222-8222-222222222222',
  name: 'Mora',
  slug: 'mora',
  createdAt: '2026-01-15T23:30:00.000Z',
  active: true,
}

it('keeps a superadmin session at eight hours', () => {
  expect(SUPERADMIN_SESSION_SECONDS).toBe(8 * 60 * 60)
})

it('shows only the firm metadata', () => {
  expect(companyAccountSchema.parse(account)).toEqual(account)
  expect(companyAccountSchema.safeParse({ ...account, memberCount: 3 }).success).toBe(false)
  expect(companyAccountSchema.safeParse({ ...account, email: 'ana@example.test' }).success).toBe(false)
  expect(companyAccountListSchema.parse({ accounts: [account] })).toEqual({ accounts: [account] })
  expect(companyAccountListSchema.safeParse({ accounts: [account], memberCount: 1 }).success).toBe(false)
})

it('accepts a rename name and refuses any other key', () => {
  expect(parseRenameTenantAccount({ name: '  Mora  ' })).toEqual({ name: 'Mora' })
  expect(() => parseRenameTenantAccount({ name: 'Mora', email: 'ana@example.test' })).toThrow(PlatformInputError)
  expect(() => parseRenameTenantAccount({ name: '' })).toThrow(PlatformInputError)
  expect(() => parseRenameTenantAccount({ name: 'A'.repeat(121) })).toThrow(PlatformInputError)
})

it('builds a shell without reading a tenant settings row', () => {
  const shell = { userId: account.id, locale: 'hr' as const, timeZone: 'Europe/Zagreb' as const }
  expect(platformShellSchema.parse(shell)).toEqual(shell)
  expect(platformShellSchema.safeParse({ ...shell, timeZone: 'Europe/Paris' }).success).toBe(false)
  expect(platformShellSchema.safeParse({ ...shell, tenantId: account.id }).success).toBe(false)
})
