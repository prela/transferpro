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

export default antfu(
  {
    type: 'app',
    // Skills and ADRs are prose. The hook formats code with ESLint.
    ignores: ['.agents/**', 'docs/**', '*.md'],
  },
  {
    plugins: {
      transferpro: {
        rules: {
          'no-dynamic-driver-import': dynamicDriverImport,
        },
      },
    },
    rules: {
      'no-restricted-imports': ['error', driverImports],
      'transferpro/no-dynamic-driver-import': 'error',
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
)
