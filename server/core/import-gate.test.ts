import { ESLint } from 'eslint'
import { beforeAll, expect, it } from 'vitest'

/**
 * Lint seam (ADR-0011): pg, pg-boss, the node-postgres driver, and the
 * kernel adapter stay in infrastructure files and tests.
 * A file on disk that imported them would fail `pnpm lint` and the hook,
 * so the forbidden source is linted in memory against the real config.
 */
const eslint = new ESLint({ cwd: process.cwd() })

// Antfu's flat config is loaded on the first lintText, not at construction.
// Pre-commit runs this file immediately after typecheck, and that load
// exceeds Vitest's default 5s test budget. Pay for it here so whichever
// assertion runs first is not the one that times out. The hook budget is
// the cold-load allowance; the tests keep the default.
beforeAll(async () => {
  await eslint.lintText('export {}\n', { filePath: 'server/core/index.ts' })
}, 30_000)

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

async function partnersTransfersImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-partners-transfers-import',
  )
}

it('rejects a Partners import of the transfers module', async () => {
  const source = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  expect(await partnersTransfersImport('server/modules/partners/infrastructure/partners.ts', source)).not.toEqual([])
  expect(await partnersTransfersImport('server/modules/partners/index.ts', dynamic)).not.toEqual([])
  expect(await partnersTransfersImport('server/modules/clients/index.ts', source)).toEqual([])
})

async function transfersCatalogDeepImport(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/no-transfers-catalog-deep-import',
  )
}

it('rejects a Transfers deep import of Clients, Locations, Vehicles, or Partners', async () => {
  const clients = `import { loadClients } from '../../clients/infrastructure/clients'\n`
  const locations = `await import('../locations/infrastructure/locations')\n`
  const vehicles = `import { loadVehicle } from '../../vehicles/infrastructure/vehicles'\n`
  const partners = `import { loadActivePartnerIds } from '../../partners/infrastructure/partners'\n`
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', clients)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/index.ts', locations)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/driver-ride-access.ts', vehicles)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', partners)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', `import { loadClients } from '../../clients'\n`)).toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/driver-ride-access.ts', `import { loadVehicle } from '../../vehicles'\n`)).toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', `import { loadActivePartnerIds } from '../../partners'\n`)).toEqual([])
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

async function capacityBoundary(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? [])
    .filter(message => message.ruleId === 'transferpro/capacity-boundary-import')
    .map(message => message.messageId)
}

it('lets only transfers import the capacity module', async () => {
  const fromApi = `import { lockTenantCapacity } from '../modules/capacity'\n`
  const fromModule = `import { lockTenantCapacity } from '../../capacity'\n`
  expect(await capacityBoundary('server/api/leak.ts', fromApi)).toEqual(['outsider'])
  expect(await capacityBoundary('server/api/rides.rls.test.ts', `await import('../modules/capacity/index')\n`)).toEqual(['outsider'])
  expect(await capacityBoundary('server/modules/drivers/infrastructure/drivers.ts', fromModule)).toEqual(['outsider'])
  expect(await capacityBoundary('server/modules/tenancy/index.ts', `export { lockTenantCapacity } from '../capacity'\n`)).toEqual(['outsider'])
  expect(await capacityBoundary('server/modules/transfers/infrastructure/assign.ts', fromModule)).toEqual([])
  expect(await capacityBoundary('server/modules/transfers/index.ts', `export { RideOverlapError } from '../capacity/index'\n`)).toEqual([])
})

it('keeps the shared capacity contract open to the browser, shared, and the server', async () => {
  const contract = `import { judgeSchedule } from './capacity'\n`
  expect(await capacityBoundary('shared/occupation-strip.ts', contract)).toEqual([])
  expect(await capacityBoundary('app/composables/leak.ts', `import { judgeSchedule } from '../../shared/capacity'\n`)).toEqual([])
  expect(await capacityBoundary('server/api/leak.ts', `import { judgeSchedule } from '../../shared/capacity'\n`)).toEqual([])
})

it('rejects a deep import of capacity internals, from transfers and its tests too', async () => {
  for (const source of [
    `import { lockTenantCapacity } from '../../capacity/infrastructure/lock'\n`,
    `await import('../../capacity/domain/errors')\n`,
    `export { judgeRideCapacity } from '../../capacity/application/judge-ride'\n`,
  ]) {
    expect(await capacityBoundary('server/modules/transfers/infrastructure/assign.ts', source), source).toEqual(['internals'])
    expect(await capacityBoundary('server/modules/transfers/infrastructure/assign.test.ts', source), source).toEqual(['internals'])
  }
})

it('lets capacity import only tenancy, drivers, and vehicles through their index, and never transfers', async () => {
  const domainFile = 'server/modules/capacity/domain/leak.ts'
  for (const source of [
    `import { RideNotFoundError } from '../../transfers'\n`,
    `await import('../../transfers/infrastructure/assign')\n`,
    `import { loadClients } from '../../clients'\n`,
    `import { rosteredDriversOnDates } from '../../roster'\n`,
    `import { loadTenantSettings } from '../../tenancy/infrastructure/tenant-settings'\n`,
  ])
    expect(await capacityBoundary(domainFile, source), source).toEqual(['dependency'])

  for (const source of [
    `import { loadTenantSettings } from '../../tenancy'\n`,
    `import { driverAssignState } from '../../drivers/index'\n`,
    `import { vehiclePresence } from '../../vehicles'\n`,
    `import { judgeOccupation } from '../domain/occupation'\n`,
    `import { judgeSchedule } from '../../../../shared'\n`,
  ])
    expect(await capacityBoundary('server/modules/capacity/application/leak.ts', source), source).toEqual([])
})

it('keeps Drizzle, Nuxt, h3, and Better Auth out of capacity domain and application', async () => {
  for (const filePath of ['server/modules/capacity/domain/leak.ts', 'server/modules/capacity/application/leak.ts']) {
    for (const source of [
      `import { sql } from 'drizzle-orm'\n`,
      `import { pgTable } from 'drizzle-orm/pg-core'\n`,
      `import { useRuntimeConfig } from '#imports'\n`,
      `import { defineEventHandler } from 'h3'\n`,
      `import { betterAuth } from 'better-auth'\n`,
      `import { PgBoss } from 'pg-boss'\n`,
    ])
      expect(await restrictedImports(filePath, source), `${filePath}: ${source}`).not.toEqual([])
  }
  expect(await restrictedImports('server/modules/capacity/infrastructure/lock.ts', `import { sql } from 'drizzle-orm'\n`)).toEqual([])
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
