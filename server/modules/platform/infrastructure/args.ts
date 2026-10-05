import { z } from 'zod'
import { tenantNameSchema } from '../../../../shared'

/**
 * Arguments for the operator scripts. A password flag is refused before
 * its value is kept, so the message cannot repeat the password.
 */
export class PlatformArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlatformArgsError'
  }
}

const superadminFlags = ['name', 'email'] as const

const createSchema = z.object({
  name: tenantNameSchema,
  email: z.email(),
})

const revokeSchema = z.object({
  email: z.email(),
})

export function parseSuperadminCreateArgs(argv: readonly string[]): { name: string, email: string } {
  const values = readFlags(argv, superadminFlags, 'pnpm superadmin:create --name <name> --email <email>\nThe password is read from the prompt, or from stdin when there is no terminal.')
  const parsed = createSchema.safeParse({
    name: values.get('name'),
    email: values.get('email'),
  })
  if (!parsed.success) {
    throw new PlatformArgsError(
      'Usage: pnpm superadmin:create --name <name> --email <email>\nThe password is read from the prompt, or from stdin when there is no terminal.',
    )
  }
  return parsed.data
}

export function parseSuperadminRevokeArgs(argv: readonly string[]): { email: string } {
  const values = readFlags(argv, ['email'], 'pnpm superadmin:revoke --email <email>')
  const parsed = revokeSchema.safeParse({ email: values.get('email') })
  if (!parsed.success)
    throw new PlatformArgsError('Usage: pnpm superadmin:revoke --email <email>')
  return parsed.data
}

export function parseTenantAccountArgs(argv: readonly string[]): { slug: string, active: boolean } {
  const values = readFlags(
    argv,
    ['slug', 'deactivate', 'reactivate'],
    'pnpm tenant:account --slug <slug> --deactivate\npnpm tenant:account --slug <slug> --reactivate',
    new Set(['deactivate', 'reactivate']),
  )
  const slug = values.get('slug')
  const deactivate = values.has('deactivate')
  const reactivate = values.has('reactivate')
  if (!slug || deactivate === reactivate) {
    throw new PlatformArgsError(
      'Usage: pnpm tenant:account --slug <slug> --deactivate\npnpm tenant:account --slug <slug> --reactivate',
    )
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new PlatformArgsError(
      'Usage: pnpm tenant:account --slug <slug> --deactivate\npnpm tenant:account --slug <slug> --reactivate',
    )
  }
  return { slug, active: reactivate }
}

function readFlags(
  argv: readonly string[],
  allowed: readonly string[],
  usage: string,
  switches: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''
    if (arg === '--')
      continue
    if (!arg.startsWith('--'))
      throw new PlatformArgsError('Unexpected argument.')
    const equals = arg.indexOf('=')
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals)
    if (name === 'password' || name === 'admin-password')
      throw new PlatformArgsError('Password must not be passed as an argument.')
    if (!allowed.includes(name))
      throw new PlatformArgsError(`Unknown argument --${name}.`)
    if (values.has(name))
      throw new PlatformArgsError(`Repeated argument --${name}.`)
    if (switches.has(name)) {
      if (equals !== -1)
        throw new PlatformArgsError(`Unknown argument --${name}.`)
      values.set(name, 'true')
      continue
    }
    const inline = equals === -1 ? undefined : arg.slice(equals + 1)
    const next = argv[index + 1]
    const value = inline ?? next
    if (value === undefined || (inline === undefined && value.startsWith('--')))
      throw new PlatformArgsError(`Missing value for --${name}.`)
    if (inline === undefined)
      index++
    values.set(name, value)
  }
  if (values.size === 0 && allowed.length > 0)
    throw new PlatformArgsError(`Usage: ${usage}`)
  return values
}
