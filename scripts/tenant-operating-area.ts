/**
 * Set or archive one Tenant's operating area, and optionally its country.
 * There is no UI and no HTTP route for this. The connection is transferpro_owner.
 * A refused value is a fixed sentence that does not repeat the value (ADR-0063).
 */
import process from 'node:process'
import { z } from 'zod'
import { OperatingAreaError, parseOperatingAreaArgs, setOperatingArea } from '../server/modules/tenancy/index'

const envSchema = z.object({
  DATABASE_MIGRATE_URL: z.url(),
})

async function main(): Promise<void> {
  const command = parseOperatingAreaArgs(process.argv.slice(2))
  const env = envSchema.safeParse(process.env)
  if (!env.success)
    throw new OperatingAreaError('DATABASE_MIGRATE_URL must be set. It is the transferpro_owner role (.env.migrate).')
  const result = await setOperatingArea({
    command,
    migrateDatabaseUrl: env.data.DATABASE_MIGRATE_URL,
  })
  const line = result === 'unchanged' ? 'operating area unchanged' : 'operating area updated'
  process.stdout.write(`${line}\n`)
}

main().catch((error: unknown) => {
  const message = error instanceof OperatingAreaError
    ? error.message
    : 'Could not update the operating area.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
