import { expect, it } from 'vitest'
import { decideDemoSeed } from './demo-seed-guard'

/**
 * The guard decides from the environment and the argument list.
 * It does not open a database and it does not name a password.
 * The picture's place ids are checked beside this file.
 */
it('refuses unless the demo flag and the mail guard both pass', () => {
  expect(decideDemoSeed({ env: {}, argv: [] })).toBe('demo-seed-required')
  expect(decideDemoSeed({ env: { DEMO_SEED: '0' }, argv: [] })).toBe('demo-seed-required')
  expect(decideDemoSeed({ env: { DEMO_SEED: 'true' }, argv: [] })).toBe('demo-seed-required')
  expect(decideDemoSeed({ env: { DEMO_SEED: '' }, argv: [] })).toBe('demo-seed-required')

  expect(decideDemoSeed({
    env: { DEMO_SEED: '1', MAILER: 'resend' },
    argv: [],
  })).toBe('mailer-resend')

  expect(decideDemoSeed({
    env: { DEMO_SEED: '1', RESEND_API_KEY: 'present' },
    argv: [],
  })).toBe('resend-key-set')

  expect(decideDemoSeed({
    env: { DEMO_SEED: '1', MAILER: 'resend', RESEND_API_KEY: 'present' },
    argv: [],
  })).toBe('mailer-resend')

  expect(decideDemoSeed({
    env: { DEMO_SEED: '0', MAILER: 'resend', RESEND_API_KEY: 'present' },
    argv: [],
  })).toBe('demo-seed-required')

  expect(decideDemoSeed({
    env: { DEMO_SEED: '1', MAILER: 'console', RESEND_API_KEY: '' },
    argv: [],
  })).toBeNull()

  expect(decideDemoSeed({
    env: { DEMO_SEED: '1', RESEND_API_KEY: '   ' },
    argv: [],
  })).toBeNull()

  expect(decideDemoSeed({
    env: { DEMO_SEED: '1' },
    argv: ['--password'],
  })).toBe('no-arguments')
})
