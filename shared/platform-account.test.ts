import { expect, it } from 'vitest'
import { companyAccountListSchema, companyAccountSchema, isPlatformTenantsPath, parsePlatformTenantListQuery, parseRenameTenantAccount, PLATFORM_TENANT_PAGE_SIZE, PlatformInputError, platformShellSchema, SUPERADMIN_SESSION_SECONDS } from './index'

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
  const list = {
    accounts: [account],
    page: 1,
    pageSize: PLATFORM_TENANT_PAGE_SIZE,
    total: 1,
  }
  expect(companyAccountListSchema.parse(list)).toEqual(list)
  expect(companyAccountListSchema.safeParse({ accounts: [account], memberCount: 1 }).success).toBe(false)
  expect(companyAccountListSchema.safeParse({ ...list, memberCount: 1 }).success).toBe(false)
})

it('reads a firm-list page and a name or slug search', () => {
  expect(PLATFORM_TENANT_PAGE_SIZE).toBe(20)
  expect(parsePlatformTenantListQuery({})).toEqual({ page: 1, q: '' })
  expect(parsePlatformTenantListQuery({ page: '2', q: '  Mora  ' })).toEqual({ page: 2, q: 'Mora' })
  expect(parsePlatformTenantListQuery({ q: 'hpl-order' })).toEqual({ page: 1, q: 'hpl-order' })
})

it('refuses a firm-list query that is not one page and one search', () => {
  expect(() => parsePlatformTenantListQuery({ page: '0' })).toThrow(PlatformInputError)
  expect(() => parsePlatformTenantListQuery({ page: '1.5' })).toThrow(PlatformInputError)
  expect(() => parsePlatformTenantListQuery({ page: '10000' })).toThrow(PlatformInputError)
  expect(() => parsePlatformTenantListQuery({ page: ['1', '2'] })).toThrow(PlatformInputError)
  expect(() => parsePlatformTenantListQuery({ q: 'A'.repeat(121) })).toThrow(PlatformInputError)
  expect(() => parsePlatformTenantListQuery({ email: 'ana@example.test' })).toThrow(PlatformInputError)
  expect(() => parsePlatformTenantListQuery(null)).toThrow(PlatformInputError)
})

it('accepts a rename name and refuses any other key', () => {
  expect(parseRenameTenantAccount({ name: '  Mora  ' })).toEqual({ name: 'Mora' })
  expect(() => parseRenameTenantAccount({ name: 'Mora', email: 'ana@example.test' })).toThrow(PlatformInputError)
  expect(() => parseRenameTenantAccount({ name: '' })).toThrow(PlatformInputError)
  expect(() => parseRenameTenantAccount({ name: 'A'.repeat(121) })).toThrow(PlatformInputError)
})

it('keeps the firm list protected when only the path case changes', () => {
  expect(isPlatformTenantsPath('/admin/tenants')).toBe(true)
  expect(isPlatformTenantsPath('/Admin/tenants')).toBe(true)
  expect(isPlatformTenantsPath('/ADMIN/TENANTS/firm')).toBe(true)
  expect(isPlatformTenantsPath('/admin/tenants/')).toBe(true)
  expect(isPlatformTenantsPath('/transfers')).toBe(false)
  expect(isPlatformTenantsPath('/forgot-password')).toBe(false)
  expect(isPlatformTenantsPath('/Forgot-password')).toBe(false)
})

it('builds a shell without reading a tenant settings row', () => {
  const shell = {
    userId: account.id,
    userName: 'Ana',
    email: 'ana@example.test',
    locale: 'hr' as const,
    timeZone: 'Europe/Zagreb' as const,
  }
  expect(platformShellSchema.parse(shell)).toEqual(shell)
  expect(platformShellSchema.safeParse({ ...shell, timeZone: 'Europe/Paris' }).success).toBe(false)
  expect(platformShellSchema.safeParse({ ...shell, tenantId: account.id }).success).toBe(false)
})
