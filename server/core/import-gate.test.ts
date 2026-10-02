import { ESLint } from 'eslint'
import { expect, it } from 'vitest'

/**
 * Lint seam (ADR-0011): pg, pg-boss, the node-postgres driver, and the
 * kernel adapter stay in infrastructure files and tests.
 * A file on disk that imported them would fail `pnpm lint` and the hook,
 * so the forbidden source is linted in memory against the real config.
 */
const eslint = new ESLint({ cwd: process.cwd() })

async function restrictedImports(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  // Static imports are no-restricted-imports. import() is a separate rule:
  // the core rule does not visit ImportExpression.
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'no-restricted-imports'
    || message.ruleId === 'transferpro/no-dynamic-driver-import',
  )
}

it('rejects driver and kernel-adapter imports outside infrastructure and tests', async () => {
  const domainFile = 'server/modules/tenancy/domain/leak.ts'
  const forbidden = [
    `import pg from 'pg'\n`,
    `import { PgBoss } from 'pg-boss'\n`,
    `import { drizzle } from 'drizzle-orm/node-postgres'\n`,
    `import { createPgBossJobQueue } from '../../../core/infrastructure'\n`,
    `await import('pg')\n`,
    `await import('../../../core/infrastructure')\n`,
  ]

  for (const source of forbidden) {
    const messages = await restrictedImports(domainFile, source)
    expect(messages, source).not.toEqual([])
  }

  // index.ts is the framework-free kernel. A relative import of the adapter
  // is the same breach as a path that spells out server/core/infrastructure.
  const fromKernel = await restrictedImports(
    'server/core/index.ts',
    `import { assertRuntimeRoles } from './infrastructure'\n`,
  )
  expect(fromKernel).not.toEqual([])

  // import() is not a static import. The same files must still fail.
  const dynamicPgFromKernel = await restrictedImports(
    'server/core/index.ts',
    `await import('pg')\n`,
  )
  expect(dynamicPgFromKernel).not.toEqual([])
})

it('allows those imports from infrastructure files and tests', async () => {
  const allowed: Array<[filePath: string, source: string]> = [
    ['server/core/infrastructure.ts', `import pg from 'pg'\nimport { PgBoss } from 'pg-boss'\nimport { drizzle } from 'drizzle-orm/node-postgres'\nawait import('pg')\n`],
    ['server/modules/tenancy/infrastructure/auth.ts', `import pg from 'pg'\nimport { drizzle } from 'drizzle-orm/node-postgres'\n`],
    ['server/core/job-queue.rls.test.ts', `import pg from 'pg'\nimport { createPgBossJobQueue } from './infrastructure'\n`],
    // boot() is the composition root. A static import of the adapter stays banned.
    ['server/core/index.ts', `const { assertRuntimeRoles } = await import('./infrastructure')\n`],
  ]

  for (const [filePath, source] of allowed) {
    const messages = await restrictedImports(filePath, source)
    expect(messages, filePath).toEqual([])
  }
})

async function consoleUse(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message => message.ruleId === 'no-console')
}

it('blocks console outside the logger module', async () => {
  const outside = await consoleUse(
    'server/modules/tenancy/domain/leak.ts',
    `console.log('ana@example.com')\n`,
  )
  expect(outside).not.toEqual([])

  const inside = await consoleUse(
    'server/core/logger.ts',
    `console.log('line')\n`,
  )
  expect(inside).toEqual([])
})
