import { z } from 'zod'

/**
 * Arguments for `pnpm tenant:create`. The password is not an argument:
 * the command reads it from the terminal or from stdin.
 */
export interface TenantCreateArgs {
  readonly name: string
  readonly slug: string
  readonly adminEmail: string
  readonly adminName: string
}

export class TenantCreateArgsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantCreateArgsError'
  }
}

const FLAGS = ['name', 'slug', 'admin-email', 'admin-name'] as const

const argsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  adminEmail: z.email(),
  adminName: z.string().trim().min(1).max(120),
})

/**
 * Parse argv after the command name. A password flag is refused before
 * its value is kept, so the message cannot repeat the password.
 */
export function parseTenantCreateArgs(argv: readonly string[]): TenantCreateArgs {
  const values = new Map<string, string>()

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''
    if (arg === '--')
      continue
    if (!arg.startsWith('--'))
      throw new TenantCreateArgsError('Unexpected argument.')

    const equals = arg.indexOf('=')
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals)
    if (name === 'password' || name === 'admin-password')
      throw new TenantCreateArgsError('Password must not be passed as an argument.')

    const inline = equals === -1 ? undefined : arg.slice(equals + 1)
    const next = argv[index + 1]
    const value = inline ?? next
    if (value === undefined || (inline === undefined && value.startsWith('--')))
      throw new TenantCreateArgsError(`Missing value for --${name}.`)
    if (inline === undefined)
      index++

    if (!FLAGS.includes(name as typeof FLAGS[number]))
      throw new TenantCreateArgsError(`Unknown argument --${name}.`)
    if (values.has(name))
      throw new TenantCreateArgsError(`Repeated argument --${name}.`)
    values.set(name, value)
  }

  const parsed = argsSchema.safeParse({
    name: values.get('name'),
    slug: values.get('slug'),
    adminEmail: values.get('admin-email'),
    adminName: values.get('admin-name'),
  })
  if (!parsed.success) {
    throw new TenantCreateArgsError(
      'Usage: pnpm tenant:create --name <name> --slug <slug> --admin-email <email> --admin-name <name>\nThe slug is lowercase letters, digits, and hyphens. The password is read from the prompt, or from stdin when there is no terminal.',
    )
  }
  return parsed.data
}
