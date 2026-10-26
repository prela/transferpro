/**
 * Whether `pnpm db:seed:demo` may open a database.
 * The flag, the production check, and the mail check are all required.
 * A flag does not override the mail check, and a safe mailer does not
 * start a seed on its own. Production is refused even with a console mailer.
 * The password is not an input: this decision never sees it.
 */

export const DEMO_SEED_REFUSALS = [
  'demo-seed-required',
  'deploy-env-production',
  'mailer-resend',
  'resend-key-set',
  'no-arguments',
] as const

export type DemoSeedRefusal = (typeof DEMO_SEED_REFUSALS)[number]

export interface DemoSeedDecisionInput {
  readonly env: {
    readonly DEMO_SEED?: string
    readonly DEPLOY_ENV?: string
    readonly MAILER?: string
    readonly RESEND_API_KEY?: string
  }
  readonly argv: readonly string[]
}

/**
 * Refuse before any connection. The flag is first, then production,
 * then the mailer, then a non-blank Resend key. A blank key counts as
 * unset. Production is refused even when the mailer is console, because
 * preview sets the same mailer as production and a mailer check alone
 * cannot tell them apart. An unset deploy env is the local run: it stays
 * allowed when the mailer is safe, and unset with `MAILER=resend` is
 * still refused. Any argument is refused so a password cannot
 * travel on the command line.
 */
export function decideDemoSeed(input: DemoSeedDecisionInput): DemoSeedRefusal | null {
  if (input.env.DEMO_SEED !== '1')
    return 'demo-seed-required'
  // Only the exact word is production. A blank value is unset, as at boot.
  if (input.env.DEPLOY_ENV === 'production')
    return 'deploy-env-production'
  if (input.env.MAILER === 'resend')
    return 'mailer-resend'
  const key = input.env.RESEND_API_KEY
  if (key !== undefined && key.trim() !== '')
    return 'resend-key-set'
  if (input.argv.length > 0)
    return 'no-arguments'
  return null
}

export function demoSeedRefusalMessage(refusal: DemoSeedRefusal): string {
  switch (refusal) {
    case 'demo-seed-required':
      return 'DEMO_SEED must be 1.'
    case 'deploy-env-production':
      return 'DEPLOY_ENV must not be production.'
    case 'mailer-resend':
      return 'MAILER must not be resend.'
    case 'resend-key-set':
      return 'RESEND_API_KEY must be unset.'
    case 'no-arguments':
      return 'This command takes no arguments.'
  }
}
