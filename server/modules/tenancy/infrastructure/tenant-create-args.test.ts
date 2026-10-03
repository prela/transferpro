import { expect, it } from 'vitest'
import { createTenant, TenantProvisionError } from './create-tenant'
import { parseTenantCreateArgs, TenantCreateArgsError } from './tenant-create-args'

it('reads the operator flags and refuses a password argument', () => {
  expect(parseTenantCreateArgs([
    '--name',
    'Pilot',
    '--slug',
    'pilot',
    '--admin-email',
    'ada@example.com',
    '--admin-name',
    'Ada',
  ])).toEqual({
    name: 'Pilot',
    slug: 'pilot',
    adminEmail: 'ada@example.com',
    adminName: 'Ada',
  })

  expect(parseTenantCreateArgs([
    '--name=Pilot',
    '--slug=pilot',
    '--admin-email=ada@example.com',
    '--admin-name=Ada',
  ])).toEqual({
    name: 'Pilot',
    slug: 'pilot',
    adminEmail: 'ada@example.com',
    adminName: 'Ada',
  })

  const secret = 'slice10-argv-password'
  expect(() => parseTenantCreateArgs(['--password', secret])).toThrow(TenantCreateArgsError)
  expect(() => parseTenantCreateArgs(['--password', secret])).toThrow('Password must not be passed as an argument.')
  expect(() => parseTenantCreateArgs([`--password=${secret}`])).toThrow('Password must not be passed as an argument.')
  expect(() => parseTenantCreateArgs(['--admin-password', secret])).toThrow('Password must not be passed as an argument.')

  try {
    parseTenantCreateArgs(['--password', secret])
  }
  catch (error) {
    expect(error).toBeInstanceOf(TenantCreateArgsError)
    expect((error as Error).message).not.toContain(secret)
  }
})

it('refuses a short password before opening a connection', async () => {
  await expect(createTenant({
    name: 'Pilot',
    slug: 'pilot',
    adminEmail: 'ada@example.com',
    adminName: 'Ada',
    password: 'short',
    authDatabaseUrl: 'postgres://transferpro_auth:pw@127.0.0.1:1/transferpro',
    migrateDatabaseUrl: 'postgres://transferpro_owner:pw@127.0.0.1:1/transferpro',
  })).rejects.toThrow(TenantProvisionError)

  await expect(createTenant({
    name: 'Pilot',
    slug: 'pilot',
    adminEmail: 'ada@example.com',
    adminName: 'Ada',
    password: 'short',
    authDatabaseUrl: 'postgres://transferpro_auth:pw@127.0.0.1:1/transferpro',
    migrateDatabaseUrl: 'postgres://transferpro_owner:pw@127.0.0.1:1/transferpro',
  })).rejects.toThrow('Password must be 8 to 128 characters.')
})
