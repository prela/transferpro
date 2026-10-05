/**
 * Operator command. There is no screen for this.
 * One owner transaction: the user, the credential, and platform.superadmin.
 * The password is read from the terminal, or from stdin when there is no terminal.
 */
import process from 'node:process'
import { z } from 'zod'
import { createSuperadmin, parseSuperadminCreateArgs, PlatformArgsError, PlatformOperatorError } from '../server/modules/platform/index'
import { PasswordPromptError, readPassword } from './read-password'

const envSchema = z.object({
  DATABASE_MIGRATE_URL: z.url(),
})

async function main(): Promise<void> {
  const args = parseSuperadminCreateArgs(process.argv.slice(2))
  const password = await readPassword()
  const env = envSchema.safeParse(process.env)
  if (!env.success)
    throw new PlatformOperatorError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role (.env.migrate).')
  await createSuperadmin({
    name: args.name,
    email: args.email,
    password,
    migrateDatabaseUrl: env.data.DATABASE_MIGRATE_URL,
  })
  process.stdout.write('created platform owner\n')
}

main().catch((error: unknown) => {
  const message = error instanceof PlatformArgsError || error instanceof PlatformOperatorError || error instanceof PasswordPromptError
    ? error.message
    : 'Could not create the platform owner.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
