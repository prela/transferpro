/**
 * Operator command. Fills the database the app is already using with one
 * fictional demo Tenant, or replaces that Tenant when it is already there.
 *
 * Refuses before any connection unless DEMO_SEED is exactly 1 and the
 * process cannot send real mail. The password is DEMO_SEED_PASSWORD when
 * that variable is non-blank, and it is not printed. Otherwise a password
 * is generated and printed once, on stdout, after the seed has committed.
 * It is never an argument.
 */
import process from 'node:process'
import { z } from 'zod'
import { decideDemoSeed, DemoSeedError, demoSeedRefusalMessage, seedDemoTenant } from '../server/modules/tenancy/index'
import { passwordLengthLimits, passwordLengthRule } from '../shared/index'

const guardEnvSchema = z.object({
  DEMO_SEED: z.string().optional(),
  MAILER: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
})

const databaseEnvSchema = z.object({
  AUTH_DATABASE_URL: z.url(),
  DATABASE_MIGRATE_URL: z.url(),
})

async function main(): Promise<void> {
  const guardEnv = guardEnvSchema.parse({
    DEMO_SEED: process.env.DEMO_SEED,
    MAILER: process.env.MAILER,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  })
  const refusal = decideDemoSeed({
    env: guardEnv,
    argv: process.argv.slice(2),
  })
  if (refusal !== null)
    throw new DemoSeedError(demoSeedRefusalMessage(refusal))

  const databaseEnv = databaseEnvSchema.safeParse(process.env)
  if (!databaseEnv.success)
    throw new DemoSeedError('AUTH_DATABASE_URL and DATABASE_MIGRATE_URL must be set.')
  const { AUTH_DATABASE_URL: authDatabaseUrl, DATABASE_MIGRATE_URL: migrateDatabaseUrl } = databaseEnv.data

  const chosen = choosePassword()
  if (passwordLengthRule(chosen.password, passwordLengthLimits) !== null)
    throw new DemoSeedError(`Password must be ${passwordLengthLimits.minPasswordLength} to ${passwordLengthLimits.maxPasswordLength} characters.`)

  await seedDemoTenant({
    password: chosen.password,
    authDatabaseUrl,
    migrateDatabaseUrl,
  })
  process.stdout.write(`seeded tenant demo\n`)
  if (chosen.generated)
    process.stdout.write(`${chosen.password}\n`)
}

/**
 * A blank DEMO_SEED_PASSWORD counts as missing. The generated value is
 * only written after commit, by the caller.
 */
function choosePassword(): { password: string, generated: boolean } {
  const configured = process.env.DEMO_SEED_PASSWORD
  if (configured !== undefined && configured.trim() !== '')
    return { password: configured, generated: false }
  return { password: generatePassword(), generated: true }
}

/**
 * Sixteen characters, inside the sign-in length rule. The alphabet skips
 * characters that are easy to misread. The value is not stored in the repo.
 */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let password = ''
  for (const byte of bytes)
    password += alphabet[byte % alphabet.length]
  return password
}

main().catch((error: unknown) => {
  const message = error instanceof DemoSeedError ? error.message : 'Could not seed the demo tenant.'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
