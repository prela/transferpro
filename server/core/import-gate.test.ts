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

async function invoicingBoundary(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/invoicing-boundary-import',
  )
}

it('lets invoicing import clients and refuses transfers, including a deep client import', async () => {
  const transfers = `import { bookRide } from '../../transfers'\n`
  const dynamic = `await import('../transfers/index')\n`
  const clients = `import { loadClientBillingDetails } from '../../clients'\n`
  const deep = `import { loadClientBillingDetails } from '../../clients/infrastructure/client-billing'\n`
  expect(await invoicingBoundary('server/modules/invoicing/infrastructure/settings.ts', transfers)).not.toEqual([])
  expect(await invoicingBoundary('server/modules/invoicing/index.ts', dynamic)).not.toEqual([])
  expect(await invoicingBoundary('server/modules/invoicing/application/save-settings.ts', clients)).toEqual([])
  expect(await invoicingBoundary('server/modules/invoicing/infrastructure/settings.ts', deep)).not.toEqual([])
  expect(await invoicingBoundary('server/modules/clients/index.ts', transfers)).toEqual([])
})

it('rejects Drizzle, Nuxt, and the queue from invoicing domain and application', async () => {
  const drizzle = `import { sql } from 'drizzle-orm'\n`
  const nuxt = `import { useRuntimeConfig } from 'nuxt/app'\n`
  const queue = `import { PgBoss } from 'pg-boss'\n`
  expect(await restrictedImports('server/modules/invoicing/domain/token-cipher.ts', drizzle)).not.toEqual([])
  expect(await restrictedImports('server/modules/invoicing/application/save-settings.ts', nuxt)).not.toEqual([])
  expect(await restrictedImports('server/modules/invoicing/application/save-settings.ts', queue)).not.toEqual([])
  expect(await restrictedImports('server/modules/invoicing/infrastructure/settings.ts', drizzle)).toEqual([])
})

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

it('rejects a Transfers deep import of Clients, Locations, Vehicles, Partners, or Invoicing', async () => {
  const clients = `import { loadClients } from '../../clients/infrastructure/clients'\n`
  const locations = `await import('../locations/infrastructure/locations')\n`
  const vehicles = `import { loadVehicle } from '../../vehicles/infrastructure/vehicles'\n`
  const partners = `import { loadActivePartnerIds } from '../../partners/infrastructure/partners'\n`
  const invoicing = `import { loadInvoicingSettings } from '../../invoicing/infrastructure/settings'\n`
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', clients)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/index.ts', locations)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/driver-ride-access.ts', vehicles)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', partners)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', invoicing)).not.toEqual([])
  expect(await transfersCatalogDeepImport('server/modules/transfers/infrastructure/transfers.ts', `import { readInvoicingSettings } from '../../invoicing'\n`)).toEqual([])
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

it('lets capacity import only tenancy, drivers, vehicles, and partners through their index, and never transfers', async () => {
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
    `import { loadActivePartnerIds } from '../../partners'\n`,
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

/**
 * Lint seam (ADR-0050): the mail outbox worker has no actor, so its loaders
 * check no role. An HTTP handler under server/api or server/routes may
 * use one only when the function that uses it, or a function enclosing
 * that use, calls officeOnly or requireRole imported from the tenancy
 * module, and that call precedes the use. A local function or any
 * same-named callee does not count. The names below are the spec.
 * eslint/worker-used-loaders.mjs is the list the rule reads.
 */
const WORKER_USED_LOADERS = [
  'loadInvitationAttempt',
  'invitationAttemptStore',
  'loadOutboxAttempt',
  'outboxAttemptStore',
  'mailOutboxStore',
  'readInvitationForMail',
  'loadClientBillingForInvoice',
] as const

async function workerLoaderRole(filePath: string, source: string) {
  const [result] = await eslint.lintText(source, { filePath })
  return (result?.messages ?? []).filter(message =>
    message.ruleId === 'transferpro/worker-loader-role',
  )
}

it('rejects an HTTP handler that uses a worker-used loader without a role guard', async () => {
  for (const name of WORKER_USED_LOADERS) {
    const source = `import { ${name} } from '../modules/mail'\nexport default function handler() {\n  return ${name}()\n}\n`
    const fromApi = await workerLoaderRole('server/api/leak.get.ts', source)
    const fromRoutes = await workerLoaderRole('server/routes/leak.get.ts', source)
    expect(fromApi, name).not.toEqual([])
    expect(fromApi.some(message => message.message.includes(name)), name).toBe(true)
    expect(fromApi.some(message => message.message.includes('ADR-0050')), name).toBe(true)
    expect(fromRoutes, name).not.toEqual([])
  }
})

it('allows the loader when the same handler calls officeOnly or requireRole', async () => {
  for (const guard of ['officeOnly', 'requireRole']) {
    const source = `import { loadInvitationAttempt } from '../modules/mail'\nimport { ${guard} } from '../modules/tenancy'\nexport default function handler(role: string) {\n  ${guard}(role)\n  return loadInvitationAttempt()\n}\n`
    expect(await workerLoaderRole('server/api/guarded.get.ts', source), guard).toEqual([])
  }
  const nuxt = `import { loadInvitationAttempt } from '../modules/mail'\nimport { officeOnly } from '../modules/tenancy'\nexport default defineEventHandler(async () => {\n  officeOnly('admin')\n  return loadInvitationAttempt()\n})\n`
  expect(await workerLoaderRole('server/api/guarded.get.ts', nuxt)).toEqual([])
})

it('reports a local no-op named officeOnly', async () => {
  const local = `import { loadInvitationAttempt } from '../modules/mail'\nfunction officeOnly() {}\nexport default function handler() {\n  officeOnly()\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', local)).not.toEqual([])
  // The import is the real binding. The inner function shadows it, so the call is the no-op.
  const shadowed = `import { loadInvitationAttempt } from '../modules/mail'\nimport { officeOnly } from '../modules/tenancy'\nexport default function handler() {\n  function officeOnly() {}\n  officeOnly()\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', shadowed)).not.toEqual([])
  // A member call and an import from another module are the same name, not the tenancy binding.
  const member = `import { loadInvitationAttempt } from '../modules/mail'\nimport * as tenancy from '../modules/tenancy'\nexport default function handler() {\n  tenancy.officeOnly('admin')\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', member)).not.toEqual([])
  const otherModule = `import { loadInvitationAttempt } from '../modules/mail'\nimport { officeOnly } from '../modules/transfers'\nexport default function handler(role: string) {\n  officeOnly(role)\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', otherModule)).not.toEqual([])
})

it('reports a role call that follows the loader use', async () => {
  const after = `import { loadInvitationAttempt } from '../modules/mail'\nimport { officeOnly } from '../modules/tenancy'\nexport default function handler(role: string) {\n  const row = loadInvitationAttempt()\n  officeOnly(role)\n  return row\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', after)).not.toEqual([])
  // The guard sits in the enclosing handler, but after the nested function that uses the loader.
  const enclosingAfter = `import { mailOutboxStore } from '../modules/transfers'\nimport { requireRole } from '../modules/tenancy'\nexport default function handler(role: string) {\n  function inner() {\n    return mailOutboxStore()\n  }\n  requireRole(role)\n  return inner()\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', enclosingAfter)).not.toEqual([])
})

it('allows an imported role call that precedes the loader use', async () => {
  const source = `import { loadInvitationAttempt } from '../modules/mail'\nimport { officeOnly } from '../modules/tenancy'\nexport default function handler(role: string) {\n  officeOnly(role)\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/guarded.get.ts', source)).toEqual([])
  const renamed = `import { loadInvitationAttempt } from '../modules/mail'\nimport { requireRole as allow } from '../modules/tenancy'\nexport default function handler(role: string) {\n  allow(role)\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/guarded.get.ts', renamed)).toEqual([])
})

it('does not treat a role guard in another function as the handler check', async () => {
  const source = `import { loadOutboxAttempt } from '../modules/transfers'\nfunction unused(role: string) {\n  officeOnly(role)\n}\nfunction requireRole() {}\nexport default function handler() {\n  return loadOutboxAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', source)).not.toEqual([])
})

it('allows a nested call when the enclosing handler checked the role', async () => {
  const source = `import { readInvitationForMail, requireRole } from '../modules/tenancy'\nexport default function handler(role: string) {\n  requireRole(role)\n  return inner()\n  function inner() {\n    return readInvitationForMail()\n  }\n}\n`
  expect(await workerLoaderRole('server/api/guarded.get.ts', source)).toEqual([])
})

it('rejects an alias, a member call, a re-export, and an import of a loader module', async () => {
  const cases = [
    `import { loadInvitationAttempt as loadEntry } from '../modules/mail'\nexport default function handler() {\n  return loadEntry()\n}\n`,
    `import * as mail from '../modules/mail'\nexport default function handler() {\n  return mail.loadInvitationAttempt()\n}\n`,
    `export { outboxAttemptStore } from '../modules/transfers'\n`,
    `await import('../modules/mail/infrastructure/invitation-attempt')\n`,
    `import * as attempt from '../modules/transfers/infrastructure/work-order-attempt'\nexport default function handler() {\n  return attempt\n}\n`,
    `export * from '../modules/transfers/infrastructure/work-order-attempt'\n`,
    `import * as mail from '../modules/mail'\nexport default function handler() {\n  const { loadInvitationAttempt } = mail\n  return 1\n}\n`,
    `export * from '../modules/mail'\n`,
  ]
  for (const source of cases)
    expect(await workerLoaderRole('server/api/leak.get.ts', source), source).not.toEqual([])
})

it('ignores module code, HTTP tests, and a handler that does not use a worker loader', async () => {
  const source = `import { loadInvitationAttempt } from '../modules/mail'\nexport function run() {\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/modules/transfers/infrastructure/failed-mail.ts', source)).toEqual([])
  expect(await workerLoaderRole('server/api/invitation-outbox.rls.test.ts', source)).toEqual([])
  expect(await workerLoaderRole('server/routes/outbox.rls.test.ts', source)).toEqual([])
  const ordinary = `import { listUpcomingRides } from '../../modules/transfers'\nexport default function handler() {\n  return listUpcomingRides()\n}\n`
  expect(await workerLoaderRole('server/api/rides/upcoming.get.ts', ordinary)).toEqual([])
  const otherExport = `import { readWorkOrderCurrentFacts } from '../modules/transfers/infrastructure/work-order-attempt'\nexport default function handler() {\n  return readWorkOrderCurrentFacts()\n}\n`
  expect(await workerLoaderRole('server/api/rides/facts.get.ts', otherExport)).toEqual([])
  const localName = `function loadInvitationAttempt() {\n  return 1\n}\nexport default function handler() {\n  return loadInvitationAttempt()\n}\n`
  expect(await workerLoaderRole('server/api/rides/local.get.ts', localName)).toEqual([])
})

it('keeps the worker-used loader names in one list', async () => {
  const listed = await import('../../eslint/worker-used-loaders.mjs')
  expect([...listed.workerUsedLoaders].sort()).toEqual([...WORKER_USED_LOADERS].sort())
  expect([...listed.workerLoaderModules].sort()).toEqual(['invitation-attempt', 'work-order-attempt'])
  expect([...listed.workerLoaderBarrels].sort()).toEqual(['mail', 'tenancy', 'transfers'])
  expect(listed.workerLoaderRoleModule).toBe('tenancy')
})

it('leaves the current HTTP tree alone', async () => {
  const results = await eslint.lintFiles(['server/api/**/*.ts'])
  const hits = results.flatMap(result =>
    (result.messages ?? [])
      .filter(message => message.ruleId === 'transferpro/worker-loader-role')
      .map(message => `${result.filePath}:${message.line} ${message.message}`),
  )
  expect(hits).toEqual([])
}, 60_000)

it('does not let a role call in another function cover an unused loader import', async () => {
  const source = `import { mailOutboxStore } from '../modules/transfers'\nimport { requireRole } from '../modules/tenancy'\nfunction other(role: string) {\n  requireRole(role)\n}\nexport default function handler() {\n  return 1\n}\n`
  expect(await workerLoaderRole('server/api/leak.get.ts', source)).not.toEqual([])
})

it('rejects an unused import of a worker loader and allows a type-only import', async () => {
  expect(await workerLoaderRole(
    'server/api/leak.get.ts',
    `import { mailOutboxStore } from '../modules/transfers'\nexport default function handler() {\n  return 1\n}\n`,
  )).not.toEqual([])
  expect(await workerLoaderRole(
    'server/api/leak.get.ts',
    `import type { InvitationReader } from '../modules/mail'\nexport default function handler() {\n  return 1\n}\n`,
  )).toEqual([])
  expect(await workerLoaderRole(
    'server/api/guarded.get.ts',
    `import { mailOutboxStore } from '../modules/transfers'\nimport { requireRole } from '../modules/tenancy'\nexport default function handler(role: string) {\n  requireRole(role)\n  return 1\n}\n`,
  )).toEqual([])
})
