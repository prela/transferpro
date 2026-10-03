/**
 * Operator command. There is no public signup.
 *
 * AUTH_DATABASE_URL is transferpro_auth: the user, the credential, the
 * organization, and the admin member. That role has no grant on schema app.
 * DATABASE_MIGRATE_URL is transferpro_owner: the one app.tenant_settings
 * row. The owner bypasses row-level security, so the tenant id is written
 * explicitly. The app role is not used.
 *
 * The password is read from the terminal, or from stdin when there is no
 * terminal. It is never an argument and it is never written out.
 */
import { Buffer } from 'node:buffer'
import process from 'node:process'
import { z } from 'zod'
import { createTenant, parseTenantCreateArgs, TenantCreateArgsError, TenantProvisionError } from '../server/modules/tenancy/index'

const envSchema = z.object({
  AUTH_DATABASE_URL: z.url(),
  DATABASE_MIGRATE_URL: z.url(),
})

async function main(): Promise<void> {
  const args = parseTenantCreateArgs(process.argv.slice(2))
  const password = await readPassword()
  const env = envSchema.safeParse(process.env)
  if (!env.success) {
    throw new TenantProvisionError(
      'AUTH_DATABASE_URL and DATABASE_MIGRATE_URL must be set. The auth URL is transferpro_auth (.env). The migrator URL is transferpro_owner (.env.migrate).',
    )
  }
  await createTenant({
    ...args,
    password,
    authDatabaseUrl: env.data.AUTH_DATABASE_URL,
    migrateDatabaseUrl: env.data.DATABASE_MIGRATE_URL,
  })
  process.stdout.write(`created tenant ${args.slug}\n`)
}

function readPassword(): Promise<string> {
  if (!process.stdin.isTTY)
    return readPipedPassword()
  return readPromptedPassword()
}

function readPipedPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    process.stdin.on('error', reject)
    process.stdin.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      const line = text.split(/\r?\n/, 1)[0] ?? ''
      if (line.length === 0)
        reject(new TenantProvisionError('Password is required.'))
      else
        resolve(line)
    })
  })
}

/**
 * Raw mode so the terminal does not echo the password.
 */
function readPromptedPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    process.stderr.write('Admin password: ')
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let password = ''
    function finish(error?: Error, value?: string) {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stderr.write('\n')
      if (error)
        reject(error)
      else if (value !== undefined)
        resolve(value)
    }
    function onData(char: string) {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (password.length === 0)
          finish(new TenantProvisionError('Password is required.'))
        else
          finish(undefined, password)
        return
      }
      if (char === '\u0003') {
        finish(new TenantProvisionError('Password is required.'))
        return
      }
      if (char === '\u007F' || char === '\b') {
        password = password.slice(0, -1)
        return
      }
      if (char < ' ' && char !== '\t')
        return
      password += char
    }
    stdin.on('data', onData)
  })
}

main().catch((error: unknown) => {
  const message = error instanceof TenantCreateArgsError || error instanceof TenantProvisionError
    ? error.message
    : 'Could not create the tenant.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
