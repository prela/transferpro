import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { parseSuperadminCreateArgs, parseSuperadminPasswordArgs, parseSuperadminRevokeArgs, parseTenantAccountArgs, PlatformArgsError } from './args'

it('refuses a password argument without repeating the value', () => {
  const password = 'super-secret-value'
  const error = new PlatformArgsError('unused')
  const thrown = (() => {
    try {
      parseSuperadminCreateArgs(['--name', 'Mora', '--email', 'mora@example.test', '--password', password])
    }
    catch (caught) {
      return caught
    }
    return error
  })()
  expect(thrown).toBeInstanceOf(PlatformArgsError)
  expect((thrown as Error).message).toBe('Password must not be passed as an argument.')
  expect((thrown as Error).message).not.toContain(password)
  expect(() => parseTenantAccountArgs(['--slug', 'mora', '--admin-password', password])).toThrow(PlatformArgsError)
})

it('reads the password-recovery email and refuses a password argument', () => {
  expect(parseSuperadminPasswordArgs(['--email', 'mora@example.test'])).toEqual({ email: 'mora@example.test' })
  expect(parseSuperadminPasswordArgs(['--email=mora@example.test'])).toEqual({ email: 'mora@example.test' })
  const password = 'super-secret-value'
  let refused = ''
  try {
    parseSuperadminPasswordArgs(['--password', password])
  }
  catch (error) {
    refused = error instanceof Error ? error.message : ''
  }
  expect(refused).toBe('Password must not be passed as an argument.')
  expect(refused).not.toContain(password)
  expect(() => parseSuperadminPasswordArgs(['--email', 'mora@example.test', `--password=${password}`])).toThrow('Password must not be passed as an argument.')
  expect(() => parseSuperadminPasswordArgs([])).toThrow(PlatformArgsError)
  expect(() => parseSuperadminPasswordArgs(['--email'])).toThrow(PlatformArgsError)
})

it('reads the operator flags and refuses a half command', () => {
  expect(parseSuperadminCreateArgs(['--name', 'Mora', '--email', 'mora@example.test'])).toEqual({
    name: 'Mora',
    email: 'mora@example.test',
  })
  expect(parseSuperadminRevokeArgs(['--email', 'mora@example.test'])).toEqual({ email: 'mora@example.test' })
  expect(parseTenantAccountArgs(['--slug', 'mora', '--deactivate'])).toEqual({ slug: 'mora', active: false })
  expect(parseTenantAccountArgs(['--slug', 'mora', '--reactivate'])).toEqual({ slug: 'mora', active: true })
  expect(() => parseTenantAccountArgs(['--slug', 'mora'])).toThrow(PlatformArgsError)
  expect(() => parseTenantAccountArgs(['--slug', 'mora', '--deactivate', '--reactivate'])).toThrow(PlatformArgsError)
  expect(() => parseSuperadminCreateArgs([])).toThrow(PlatformArgsError)
})

it('wires the operator commands', () => {
  const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>
  expect(scripts['superadmin:create']).toContain('scripts/superadmin-create.ts')
  expect(scripts['superadmin:revoke']).toContain('scripts/superadmin-revoke.ts')
  expect(scripts['superadmin:password']).toContain('scripts/superadmin-password.ts')
  expect(scripts['tenant:account']).toContain('scripts/tenant-account.ts')
})
