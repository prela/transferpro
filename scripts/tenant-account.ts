/**
 * Emergency lever. Deactivate or reactivate one firm.
 * There is no UI and no HTTP route for this. The connection is transferpro_owner.
 */
import process from 'node:process'
import { z } from 'zod'
import { parseTenantAccountArgs, PlatformArgsError, PlatformOperatorError, setTenantActive } from '../server/modules/platform/index'

const envSchema = z.object({
  DATABASE_MIGRATE_URL: z.url(),
})

async function main(): Promise<void> {
  const args = parseTenantAccountArgs(process.argv.slice(2))
  const env = envSchema.safeParse(process.env)
  if (!env.success)
    throw new PlatformOperatorError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role (.env.migrate).')
  const result = await setTenantActive({
    slug: args.slug,
    active: args.active,
    migrateDatabaseUrl: env.data.DATABASE_MIGRATE_URL,
  })
  const verb = args.active ? 'reactivated' : 'deactivated'
  const line = result === 'unchanged' ? `tenant already ${args.active ? 'active' : 'inactive'}` : `${verb} tenant ${args.slug}`
  process.stdout.write(`${line}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof PlatformArgsError || error instanceof PlatformOperatorError
    ? error.message
    : 'Could not update the tenant account.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
