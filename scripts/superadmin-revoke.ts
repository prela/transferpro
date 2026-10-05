/**
 * Deletes the platform.superadmin row and leaves the user.
 * Not reachable from the UI.
 */
import process from 'node:process'
import { z } from 'zod'
import { parseSuperadminRevokeArgs, PlatformArgsError, PlatformOperatorError, revokeSuperadmin } from '../server/modules/platform/index'

const envSchema = z.object({
  DATABASE_MIGRATE_URL: z.url(),
})

async function main(): Promise<void> {
  const args = parseSuperadminRevokeArgs(process.argv.slice(2))
  const env = envSchema.safeParse(process.env)
  if (!env.success)
    throw new PlatformOperatorError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role (.env.migrate).')
  await revokeSuperadmin({
    email: args.email,
    migrateDatabaseUrl: env.data.DATABASE_MIGRATE_URL,
  })
  process.stdout.write('revoked platform owner\n')
}

main().catch((error: unknown) => {
  const message = error instanceof PlatformArgsError || error instanceof PlatformOperatorError
    ? error.message
    : 'Could not revoke the platform owner.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
