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

async function tenancyTestingImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-tenancy-testing-import',
  )
}

it('rejects tenancy/testing imports from server/api, app, server/plugins and server/core', async () => {
  const source = `import { insertCredentialUser } from '../modules/tenancy/testing'\n`
  const dynamic = `await import('../modules/tenancy/testing.ts')\n`
  const reexport = `export { insertCredentialUser } from '../modules/tenancy/testing'\n`

  for (const filePath of [
    'server/api/leak.ts',
    'app/components/leak.ts',
    'server/api/clients.rls.test.ts',
    'server/plugins/leak.ts',
    'server/core/leak.ts',
  ]) {
    expect(await tenancyTestingImport(filePath, source), filePath).not.toEqual([])
    expect(await tenancyTestingImport(filePath, dynamic), filePath).not.toEqual([])
    expect(await tenancyTestingImport(filePath, reexport), filePath).not.toEqual([])
  }
})

it('rejects a deep credential-member import from those same trees', async () => {
  const source = `import { insertCredentialUser } from '../modules/tenancy/infrastructure/credential-member'\n`
  const dynamic = `await import('../modules/tenancy/infrastructure/credential-member.ts')\n`
  const reexport = `export { insertCredentialUser } from '../tenancy/infrastructure/credential-member'\n`

  for (const filePath of [
    'server/api/leak.ts',
    'app/components/leak.ts',
    'server/plugins/leak.ts',
    'server/core/leak.ts',
  ]) {
    expect(await tenancyTestingImport(filePath, source), filePath).not.toEqual([])
    expect(await tenancyTestingImport(filePath, dynamic), filePath).not.toEqual([])
    expect(await tenancyTestingImport(filePath, reexport), filePath).not.toEqual([])
  }
})

it('allows tenancy/testing imports from e2e and module tests', async () => {
  const source = `import { insertCredentialMember } from '../../server/modules/tenancy/testing'\n`
  const allowed = [
    'e2e/fixtures/seed.ts',
    'server/modules/tenancy/infrastructure/member-management.rls.test.ts',
  ]
  for (const filePath of allowed) {
    expect(await tenancyTestingImport(filePath, source), filePath).toEqual([])
  }
})

async function driversTransfersImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-drivers-transfers-import',
  )
}

it('rejects a Drivers import of the transfers module', async () => {
  const source = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  expect(await driversTransfersImport('server/modules/drivers/infrastructure/drivers.ts', source)).not.toEqual([])
  expect(await driversTransfersImport('server/modules/drivers/index.ts', dynamic)).not.toEqual([])
  expect(await driversTransfersImport('server/modules/clients/index.ts', source)).toEqual([])
})

async function vehiclesTransfersImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-vehicles-transfers-import',
  )
}

async function rosterTransfersImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-roster-transfers-import',
  )
}

async function locationsTransfersImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-locations-transfers-import',
  )
}

it('rejects a Locations import of the transfers module', async () => {
  const source = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  expect(await locationsTransfersImport('server/modules/locations/infrastructure/locations.ts', source)).not.toEqual([])
  expect(await locationsTransfersImport('server/modules/locations/index.ts', dynamic)).not.toEqual([])
  expect(await locationsTransfersImport('server/modules/vehicles/index.ts', source)).toEqual([])
})

async function clientsTransfersImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-clients-transfers-import',
  )
}

it('rejects a Clients import of the transfers module', async () => {
  const source = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  expect(await clientsTransfersImport('server/modules/clients/infrastructure/clients.ts', source)).not.toEqual([])
  expect(await clientsTransfersImport('server/modules/clients/index.ts', dynamic)).not.toEqual([])
  expect(await clientsTransfersImport('server/modules/locations/index.ts', source)).toEqual([])
})

async function transfersCatalogDeepImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-transfers-catalog-deep-import',
  )
}

it('rejects a Transfers deep import of Clients or Locations', async () => {
  const clients = `import { loadClients } from '../../clients/infrastructure/clients'\n`
  const locations = `await import('../locations/infrastructure/locations')\n`
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', clients)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/index.ts', locations)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', `import { loadClients } from '../../clients'\n`)).toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/locations/infrastructure/locations.ts', clients)).toEqual([])
})

it('rejects a Roster import of the transfers module', async () => {
  const source = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  expect(await rosterTransfersImport('server/modules/roster/infrastructure/roster.ts', source)).not.toEqual([])
  expect(await rosterTransfersImport('server/modules/roster/index.ts', dynamic)).not.toEqual([])
  expect(await rosterTransfersImport('server/modules/vehicles/index.ts', source)).toEqual([])
})

it('rejects a Vehicles import of the transfers module', async () => {
  const source = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  expect(await vehiclesTransfersImport('server/modules/vehicles/infrastructure/vehicles.ts', source)).not.toEqual([])
  expect(await vehiclesTransfersImport('server/modules/vehicles/index.ts', dynamic)).not.toEqual([])
  expect(await vehiclesTransfersImport('server/modules/drivers/index.ts', source)).toEqual([])
})

async function expiringDocumentsTransfersImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-expiring-documents-transfers-import',
  )
}

it('rejects an expiring-documents import of the transfers module', async () => {
  const source = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  expect(await expiringDocumentsTransfersImport('server/modules/expiring-documents/infrastructure/expiring-documents.ts', source)).not.toEqual([])
  expect(await expiringDocumentsTransfersImport('server/modules/expiring-documents/index.ts', dynamic)).not.toEqual([])
  expect(await expiringDocumentsTransfersImport('server/modules/drivers/index.ts', source)).toEqual([])
})

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
