import antfu from '@antfu/eslint-config'

/**
 * ADR-0011: the kernel adapter and the Postgres drivers stay behind
 * infrastructure files. Domain, application, and server/core/index.ts
 * reach them through the port, not a direct import.
 * Tests are allowed because the RLS suite observes real sessions.
 */
const driverImports = {
  paths: [
    {
      name: 'pg',
      message: 'Import pg only from an infrastructure file or a test (ADR-0011).',
    },
    {
      name: 'pg-boss',
      message: 'Import pg-boss only from an infrastructure file or a test (ADR-0011).',
    },
    {
      name: 'drizzle-orm/node-postgres',
      message: 'Import drizzle-orm/node-postgres only from an infrastructure file or a test (ADR-0011).',
    },
  ],
  patterns: [
    {
      group: [
        '**/core/infrastructure',
        '**/core/infrastructure.js',
        '**/core/infrastructure.ts',
      ],
      message: 'Import server/core/infrastructure only from an infrastructure file or a test (ADR-0011).',
    },
  ],
}

const infrastructureAndTests = [
  'server/core/infrastructure.ts',
  'server/**/infrastructure/**',
  '**/*.test.ts',
  // Playwright seeds rows the same way the RLS tests do.
  'e2e/**/*.ts',
]

const driverSpecifiers = new Set([
  'pg',
  'pg-boss',
  'drizzle-orm/node-postgres',
])

/**
 * no-restricted-imports does not visit import(). This rule does.
 * boot() in server/core/index.ts is the one allowed dynamic load of
 * ./infrastructure: a static import would pull pg into the kernel module.
 */
const dynamicDriverImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'Import {{name}} only from an infrastructure file or a test (ADR-0011).',
    },
  },
  create(context) {
    return {
      ImportExpression(node) {
        if (node.source.type !== 'Literal' || typeof node.source.value !== 'string')
          return

        const source = node.source.value
        const filename = (context.filename ?? '').replaceAll('\\', '/')
        const bootLoadsAdapter = source === './infrastructure'
          && filename.endsWith('/server/core/index.ts')
        if (bootLoadsAdapter)
          return

        const adapter = /(?:^|\/)core\/infrastructure(?:\.[cm]?[jt]s)?$/.test(source)
        const relativeAdapter = (source === './infrastructure' || source === './infrastructure.js' || source === './infrastructure.ts')
          && /\/server\/core\/[^/]+\.ts$/.test(filename)
          && !filename.endsWith('/server/core/infrastructure.ts')
        if (!driverSpecifiers.has(source) && !adapter && !relativeAdapter)
          return

        context.report({ node, messageId: 'banned', data: { name: source } })
      },
    }
  },
}

/**
 * ADR-0013: the operator script and invite accept are the account-creation
 * paths. server/modules/tenancy/testing.ts is the test and e2e exception.
 * server/api, app, server/plugins, and server/core must not import it,
 * including their tests. A deep import of credential-member is the same
 * leak: those insertCredential* helpers stay off the production trees.
 */
/**
 * Drivers is its own module (ADR-0018). Rides will reference Drivers later.
 * This module does not import the transfers module, including through import().
 */
const driversTransfersImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'The Drivers module does not import the transfers module (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !(/(?:^|\/)transfers(?:\/|$)/).test(source))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/modules/drivers/'))
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

const vehiclesTransfersImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'The Vehicles module does not import the transfers module (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !(/(?:^|\/)transfers(?:\/|$)/).test(source))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/modules/vehicles/'))
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

const locationsTransfersImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'The Locations module does not import the transfers module (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !(/(?:^|\/)transfers(?:\/|$)/).test(source))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/modules/locations/'))
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

const clientsTransfersImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'The Clients module does not import the transfers module (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !(/(?:^|\/)transfers(?:\/|$)/).test(source))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/modules/clients/'))
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

/**
 * Transfers may name a Client, a Location, or a Vehicle only through that module's index.
 * A deep import of infrastructure would couple the booking to the catalog's internals.
 */
const transfersCatalogDeepImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'Transfers reach Clients, Locations, and Vehicles through their index.ts only (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !/(?:^|\/)(?:clients|locations|vehicles)\/infrastructure(?:\/|$)/.test(source))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/modules/transfers/'))
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

const rosterTransfersImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'The Roster module does not import the transfers module (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !(/(?:^|\/)transfers(?:\/|$)/).test(source))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/modules/roster/'))
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

const expiringDocumentsTransfersImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'The expiring-documents module does not import the transfers module (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !(/(?:^|\/)transfers(?:\/|$)/).test(source))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/modules/expiring-documents/'))
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

const tenancyTestingImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'Import tenancy/testing, platform/testing, or credential-member only from e2e or a test outside server/api, app, server/plugins, and server/core (ADR-0013, ADR-0019).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string'
        || (!source.includes('tenancy/testing')
          && !source.includes('credential-member')
          && !source.includes('platform/testing'))) {
        return
      }
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      const bannedTree = filename.includes('/server/api/')
        || filename.includes('/app/')
        || filename.includes('/server/plugins/')
        || filename.includes('/server/core/')
      if (!bannedTree)
        return
      context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source?.type === 'Literal')
          check(node.source, node.source.value)
      },
      ExportAllDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

/**
 * ADR-0019: platform does not import tenancy internals, and tenancy does not
 * import the platform module. Tests may reach either side.
 */
const platformBoundaryImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'Platform and tenancy do not import each other except through tenancy\'s public index (ADR-0019).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string')
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      const test = filename.includes('.test.ts')
      if (test)
        return
      const platform = filename.includes('/server/modules/platform/')
      const tenancy = filename.includes('/server/modules/tenancy/')
      if (platform && source.includes('tenancy/infrastructure'))
        context.report({ node, messageId: 'banned' })
      if (tenancy && source.includes('modules/platform'))
        context.report({ node, messageId: 'banned' })
    }

    return {
      ImportDeclaration(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal')
          check(node.source, node.source.value)
      },
    }
  },
}

export default antfu(
  {
    type: 'app',
    // Skills and ADRs are prose. The hook formats code with ESLint.
    ignores: ['.agents/**', 'docs/**', '*.md', 'playwright-report/**', 'test-results/**', 'blob-report/**'],
  },
  {
    plugins: {
      transferpro: {
        rules: {
          'no-dynamic-driver-import': dynamicDriverImport,
          'no-tenancy-testing-import': tenancyTestingImport,
          'no-drivers-transfers-import': driversTransfersImport,
          'no-vehicles-transfers-import': vehiclesTransfersImport,
          'no-locations-transfers-import': locationsTransfersImport,
          'no-clients-transfers-import': clientsTransfersImport,
          'no-transfers-catalog-deep-import': transfersCatalogDeepImport,
          'no-roster-transfers-import': rosterTransfersImport,
          'no-expiring-documents-transfers-import': expiringDocumentsTransfersImport,
          'no-platform-boundary-import': platformBoundaryImport,
        },
      },
    },
    rules: {
      'no-restricted-imports': ['error', driverImports],
      'transferpro/no-dynamic-driver-import': 'error',
      'transferpro/no-tenancy-testing-import': 'error',
      'transferpro/no-drivers-transfers-import': 'error',
      'transferpro/no-vehicles-transfers-import': 'error',
      'transferpro/no-locations-transfers-import': 'error',
      'transferpro/no-clients-transfers-import': 'error',
      'transferpro/no-transfers-catalog-deep-import': 'error',
      'transferpro/no-roster-transfers-import': 'error',
      'transferpro/no-expiring-documents-transfers-import': 'error',
      'transferpro/no-platform-boundary-import': 'error',
    },
  },
  {
    // index.ts says `./infrastructure`. That specifier does not contain
    // `core/infrastructure`, so the global pattern would miss it.
    files: ['server/core/**/*.ts'],
    ignores: infrastructureAndTests,
    rules: {
      'no-restricted-imports': ['error', {
        ...driverImports,
        patterns: [
          ...driverImports.patterns,
          {
            group: ['./infrastructure', './infrastructure.js', './infrastructure.ts'],
            message: 'Import server/core/infrastructure only from an infrastructure file or a test (ADR-0011).',
          },
        ],
      }],
    },
  },
  {
    files: infrastructureAndTests,
    rules: {
      'no-restricted-imports': 'off',
      'transferpro/no-dynamic-driver-import': 'off',
    },
  },
  {
    // One logger. A console call anywhere else would skip redaction.
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['server/core/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
)
