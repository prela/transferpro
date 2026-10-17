/**
 * Operator recovery. There is no screen and no reset mail for this.
 * One owner transaction: the credential hash and every session of that user.
 * The password is read from the terminal, or from stdin when there is no terminal.
 * `--password` is refused by the parser before the prompt or the database runs.
 */
import process from 'node:process'
import { z } from 'zod'
import { parseSuperadminPasswordArgs, PlatformArgsError, PlatformOperatorError, setSuperadminPassword } from '../server/modules/platform/index'
import { PasswordPromptError, readPassword } from './read-password'

const envSchema = z.object({
  DATABASE_MIGRATE_URL: z.url(),
})

async function main(): Promise<void> {
  const args = parseSuperadminPasswordArgs(process.argv.slice(2))
  const password = await readPassword()
  const env = envSchema.safeParse(process.env)
  if (!env.success)
    throw new PlatformOperatorError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role (.env.migrate).')
  await setSuperadminPassword({
    email: args.email,
    password,
    migrateDatabaseUrl: env.data.DATABASE_MIGRATE_URL,
  })
  process.stdout.write('set platform owner password\n')
}

main().catch((error: unknown) => {
  const message = error instanceof PlatformArgsError || error instanceof PlatformOperatorError || error instanceof PasswordPromptError
    ? error.message
    : 'Could not set the platform owner password.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
