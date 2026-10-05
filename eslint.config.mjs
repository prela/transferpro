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
 * server/api and app must not import it, including their tests.
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

const tenancyTestingImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'Import tenancy/testing only from e2e or a test outside server/api (ADR-0013).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !source.includes('tenancy/testing'))
        return
      const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
      if (!filename.includes('/server/api/') && !filename.includes('/app/'))
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
        },
      },
    },
    rules: {
      'no-restricted-imports': ['error', driverImports],
      'transferpro/no-dynamic-driver-import': 'error',
      'transferpro/no-tenancy-testing-import': 'error',
      'transferpro/no-drivers-transfers-import': 'error',
      'transferpro/no-vehicles-transfers-import': 'error',
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
