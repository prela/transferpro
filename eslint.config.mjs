import path from 'node:path'
import antfu from '@antfu/eslint-config'
import { workerLoaderBarrels, workerLoaderModules, workerLoaderRoleModule, workerUsedLoaders } from './eslint/worker-used-loaders.mjs'

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
  // e2e/prepare-database.ts creates transferpro_e2e before the suite.
  'e2e/**/*.ts',
]

const driverSpecifiers = new Set([
  'pg',
  'pg-boss',
  'drizzle-orm/node-postgres',
])

/**
 * no-restricted-imports does not visit import(). This rule does.
 * The kernel entry is the one allowed dynamic load of
 * ./infrastructure: a static import would pull pg into the kernel module.
 * boot() and assertReady() share that load.
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

const partnersTransfersImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'The Partners module does not import the transfers module (ADR-0036, ADR-0049).',
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
      if (!filename.includes('/server/modules/partners/'))
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
 * Transfers may name a Client, a Location, a Vehicle, or a Partner only through that module's index.
 * A deep import of infrastructure would couple the booking to the catalog's internals.
 */
const transfersCatalogDeepImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      banned: 'Transfers reach Clients, Locations, Vehicles, and Partners through their index.ts only (ADR-0018).',
    },
  },
  create(context) {
    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string' || !/(?:^|\/)(?:clients|locations|vehicles|partners)\/infrastructure(?:\/|$)/.test(source))
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

/**
 * ADR-0034: only transfers imports the capacity module, and only through
 * its index.ts. Capacity may import tenancy, drivers, and vehicles, again
 * only through their index.ts, and never transfers. Partners joins the
 * list in the Partner windows ticket (#357). Tests are held to the same lines, so a
 * test reaches capacity internals only from inside capacity.
 * `shared/capacity.ts` is the contract, not the module, and stays open.
 */
const capacityModuleImports = new Set(['tenancy', 'drivers', 'vehicles'])

const capacityBoundaryImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      outsider: 'Only the transfers module imports capacity (ADR-0034).',
      internals: 'Import the capacity module through its index.ts only (ADR-0034).',
      dependency: 'Capacity imports only tenancy, drivers, and vehicles, through their index.ts, and never transfers (ADR-0034).',
    },
  },
  create(context) {
    const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
    const inCapacity = filename.includes('/server/modules/capacity/')
    const inTransfers = filename.includes('/server/modules/transfers/')

    /** The module an import lands in, and the path inside it. Null when it is not a server module. */
    function targetModule(source) {
      let target
      if (source.startsWith('.'))
        target = path.posix.resolve(path.posix.dirname(filename), source)
      else if (source.includes('server/modules/'))
        target = `/${source.slice(source.indexOf('server/modules/'))}`
      else
        return null
      const match = /\/server\/modules\/([^/]+)(\/.*)?$/.exec(target)
      return match ? { name: match[1], rest: match[2] ?? '' } : null
    }

    function throughIndex(rest) {
      return rest === '' || /^\/index(?:\.[cm]?[jt]s)?$/.test(rest)
    }

    /**
     * @param {import('estree').Node} node
     * @param {unknown} source
     */
    function check(node, source) {
      if (typeof source !== 'string')
        return
      const target = targetModule(source)
      if (!target)
        return
      if (inCapacity) {
        if (target.name === 'capacity')
          return
        if (!capacityModuleImports.has(target.name) || !throughIndex(target.rest))
          context.report({ node, messageId: 'dependency' })
        return
      }
      if (target.name !== 'capacity')
        return
      if (!inTransfers)
        context.report({ node, messageId: 'outsider' })
      else if (!throughIndex(target.rest))
        context.report({ node, messageId: 'internals' })
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
 * ADR-0034 and AGENTS.md: capacity's domain and application tiers reach
 * the database, the framework, and the queue only through ports. The
 * global driver list still applies; this adds Drizzle, Nuxt, h3, and
 * Better Auth for those two tiers.
 */
const capacityCoreImports = {
  paths: [
    ...driverImports.paths,
    // `#app` and `#imports` are listed here: a pattern group reads a leading `#` as a comment.
    ...['drizzle-orm', 'nuxt', '#app', '#imports', 'h3', 'better-auth'].map(name => ({
      name,
      message: `Capacity's domain and application do not import ${name}; use a port (ADR-0034).`,
    })),
  ],
  patterns: [
    ...driverImports.patterns,
    {
      group: ['drizzle-orm/*', 'nuxt/*', 'better-auth/*'],
      message: 'Capacity\'s domain and application do not import Drizzle, Nuxt, or Better Auth; use a port (ADR-0034).',
    },
  ],
}

/**
 * ADR-0050: the mail outbox worker has no actor, so the loaders it calls
 * check no role. A non-test file under server/api or server/routes may use
 * one only from a function that calls officeOnly or requireRole imported
 * from the tenancy module, or from a function enclosed by that call, and
 * the call has to precede the use. A local function, a same-named callee,
 * and a guard in a sibling function do not cover the handler. The names
 * live in worker-used-loaders.mjs. A renamed destructure is judged at the
 * pattern. The path check sees string-literal sources.
 */
const WORKER_LOADER_GUARDS = new Set(['officeOnly', 'requireRole'])
const WORKER_LOADER_NAMES = new Set(workerUsedLoaders)

const workerLoaderRole = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      unguarded: 'A worker-used mail loader ({{name}}) needs officeOnly or requireRole, imported from the tenancy module and called before that use (ADR-0050).',
    },
  },
  create(context) {
    const filename = `/${(context.filename ?? '').replaceAll('\\', '/')}`.replaceAll(/\/+/g, '/')
    if (!isWorkerLoaderHttpFile(filename))
      return {}

    /** @type {{ parent: number | null, functionNode: import('estree').Node | null, guards: import('estree').CallExpression[], loaderUses: { node: import('estree').Node, label: string }[] }[]} */
    const scopes = [{ parent: null, functionNode: null, guards: [], loaderUses: [] }]
    /** @type {number[]} */
    const stack = [0]
    /** Local binding imported from a worker loader, mapped to the name the message should cite. */
    const loaderLocals = new Map()
    /** Import specifier for that binding, so an unused import still fails. */
    const importedNodes = new Map()
    const usedLocals = new Set()

    /**
     * The function being visited, or the program when the node is at the top.
     * @returns {{ parent: number | null, functionNode: import('estree').Node | null, guards: import('estree').CallExpression[], loaderUses: { node: import('estree').Node, label: string }[] }} the scope of the current node
     */
    function activeScope() {
      return scopes[stack[stack.length - 1] ?? 0]
    }

    /**
     * @param {string} local
     * @param {string} label
     * @param {import('estree').Node} node
     */
    function recordImportedLoader(local, label, node) {
      loaderLocals.set(local, label)
      importedNodes.set(local, node)
    }

    /**
     * @param {import('estree').Node} node
     * @param {string} label
     */
    function recordLoaderUse(node, label) {
      activeScope().loaderUses.push({ node, label })
    }

    /**
     * The binding this identifier resolves to. A local declaration of the
     * same name is found first, which is what makes a shadowed officeOnly fail.
     * @param {import('estree').Identifier} identifier
     */
    function resolvedVariable(identifier) {
      let scope = context.sourceCode.getScope(identifier)
      while (scope) {
        const variable = scope.set.get(identifier.name)
        if (variable)
          return variable
        scope = scope.upper
      }
      return null
    }

    /**
     * True when this call is the tenancy binding officeOnly or requireRole.
     * A local function, a member call, and an import from any other module
     * resolve to something else, so they do not count (ADR-0050).
     * @param {import('estree').CallExpression} node
     */
    function isRoleGuardCall(node) {
      if (node.callee.type !== 'Identifier')
        return false
      const variable = resolvedVariable(node.callee)
      const def = variable?.defs.find(item => item.type === 'ImportBinding')
      if (!def || def.node.type !== 'ImportSpecifier')
        return false
      if (def.node.importKind === 'type' || def.parent?.importKind === 'type')
        return false
      const imported = importedBindingName(def.node)
      if (!imported || !WORKER_LOADER_GUARDS.has(imported))
        return false
      const source = literalSource(def.parent?.source)
      return source !== null && isWorkerLoaderRoleModule(source)
    }

    /**
     * @param {import('estree').Node} node
     */
    function sourceOffset(node) {
      return node.range?.[0] ?? 0
    }

    /**
     * A guard in this function must sit before the use. A guard in an
     * enclosing function must sit before that nested function. Source order
     * is the check: the rule does not follow calls.
     * @param {number} scopeId
     * @param {import('estree').Node} useNode
     */
    function roleCallPrecedes(scopeId, useNode) {
      let boundary = sourceOffset(useNode)
      /** @type {number | null} */
      let id = scopeId
      while (id !== null) {
        const scope = scopes[id]
        if (!scope)
          return false
        if (scope.functionNode) {
          for (const guard of scope.guards) {
            if (sourceOffset(guard) < boundary)
              return true
          }
          boundary = sourceOffset(scope.functionNode)
        }
        id = scope.parent
      }
      return false
    }

    /**
     * Enter and leave are separate keys. A comma-separated `:exit` selector
     * is handed to esquery whole, and ESLint 10 rejects the class name.
     * @param {import('estree').Node} node
     */
    function enterFunction(node) {
      const id = scopes.length
      scopes.push({
        parent: stack[stack.length - 1] ?? 0,
        functionNode: node,
        guards: [],
        loaderUses: [],
      })
      stack.push(id)
    }
    function leaveFunction() {
      stack.pop()
    }

    return {
      'FunctionDeclaration': enterFunction,
      'FunctionDeclaration:exit': leaveFunction,
      'FunctionExpression': enterFunction,
      'FunctionExpression:exit': leaveFunction,
      'ArrowFunctionExpression': enterFunction,
      'ArrowFunctionExpression:exit': leaveFunction,
      CallExpression(node) {
        // A top-level call is not a handler and does not cover a nested use.
        if (activeScope().functionNode && isRoleGuardCall(node))
          activeScope().guards.push(node)
      },
      ImportDeclaration(node) {
        if (node.importKind === 'type')
          return
        const source = literalSource(node.source)
        const moduleName = source ? workerLoaderModuleName(source) : null
        if (moduleName && node.specifiers.length === 0)
          recordLoaderUse(node, moduleName)
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportSpecifier' && spec.importKind === 'type')
            continue
          const local = spec.local?.name
          if (!local)
            continue
          if (spec.type === 'ImportSpecifier') {
            const imported = importedBindingName(spec)
            // Another export of a loader file is not itself a worker loader.
            if (imported && WORKER_LOADER_NAMES.has(imported))
              recordImportedLoader(local, imported, spec)
            continue
          }
          if (moduleName)
            recordImportedLoader(local, moduleName, spec)
        }
      },
      ImportExpression(node) {
        const source = literalSource(node.source)
        const moduleName = source ? workerLoaderModuleName(source) : null
        if (moduleName)
          recordLoaderUse(node, moduleName)
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === 'type' || !node.source)
          return
        for (const spec of node.specifiers) {
          if (spec.type !== 'ExportSpecifier' || spec.exportKind === 'type')
            continue
          const local = spec.local.type === 'Identifier' ? spec.local.name : String(spec.local.value)
          if (WORKER_LOADER_NAMES.has(local))
            recordLoaderUse(spec, local)
        }
      },
      ExportAllDeclaration(node) {
        const source = literalSource(node.source)
        if (!source)
          return
        const moduleName = workerLoaderModuleName(source)
        if (moduleName)
          recordLoaderUse(node, moduleName)
        else if (isWorkerLoaderBarrel(source))
          recordLoaderUse(node, 'workerUsedLoaders')
      },
      Identifier(node) {
        // Only a binding that was imported. A local of the same name is not a loader.
        const label = loaderLocals.get(node.name)
        if (!label || isImportBinding(node) || isDeclaredName(node) || isMemberProperty(node) || isNonShorthandKey(node))
          return
        usedLocals.add(node.name)
        recordLoaderUse(node, label)
      },
      MemberExpression(node) {
        const name = memberPropertyName(node)
        if (name && WORKER_LOADER_NAMES.has(name))
          recordLoaderUse(node, name)
      },
      Property(node) {
        if (node.parent?.type !== 'ObjectPattern' || node.computed)
          return
        const name = node.key.type === 'Identifier' ? node.key.name : null
        if (name && WORKER_LOADER_NAMES.has(name))
          recordLoaderUse(node, name)
      },
      'Program:exit': function () {
        scopes.forEach((scope, id) => {
          for (const item of scope.loaderUses) {
            if (roleCallPrecedes(id, item.node))
              continue
            context.report({ node: item.node, messageId: 'unguarded', data: { name: item.label } })
          }
        })
        // An unused import is not inside a function, so order cannot apply.
        // Only a guard in the default-exported handler covers it. A call in
        // a sibling function does not (ADR-0050). A use the guard does not
        // precede is still reported from that function's loader uses.
        const handlerGuarded = scopes.some(scope =>
          scope.functionNode !== null
          && scope.guards.length > 0
          && isRouteHandler(scope.functionNode),
        )
        for (const [local, spec] of importedNodes) {
          if (!usedLocals.has(local) && !handlerGuarded) {
            context.report({
              node: spec,
              messageId: 'unguarded',
              data: { name: loaderLocals.get(local) ?? local },
            })
          }
        }
      },
    }
  },
}

/**
 * @param {string} filename
 */
function isWorkerLoaderHttpFile(filename) {
  const http = filename.includes('/server/api/') || filename.includes('/server/routes/')
  if (!http)
    return false
  const base = filename.split('/').pop() ?? ''
  return !/\.(?:test|spec)\.[cm]?[jt]s$/.test(base)
}

/**
 * @param {import('estree').Node | null | undefined} node
 */
function literalSource(node) {
  if (!node || node.type !== 'Literal' || typeof node.value !== 'string')
    return null
  return node.value
}

/**
 * @param {string} source
 */
function bareModulePath(source) {
  return source.replaceAll('\\', '/').replace(/\.[cm]?[jt]s$/, '').replace(/\/index$/, '')
}

/**
 * @param {string} source
 * @param {readonly string[]} names
 * @returns {string | null} the listed segment this path ends with
 */
function matchingPathSegment(source, names) {
  const bare = bareModulePath(source)
  return names.find(name => bare === name || bare.endsWith(`/${name}`)) ?? null
}

/**
 * @param {string} source
 */
function workerLoaderModuleName(source) {
  return matchingPathSegment(source, workerLoaderModules)
}

/**
 * @param {string} source
 */
function isWorkerLoaderBarrel(source) {
  return matchingPathSegment(source, workerLoaderBarrels) !== null
}

/**
 * @param {string} source
 */
function isWorkerLoaderRoleModule(source) {
  return matchingPathSegment(source, [workerLoaderRoleModule]) !== null
}

/**
 * The route handler is the default export, or the function passed straight
 * to that export (`defineEventHandler(async () => …)`). A sibling function
 * is not the handler, so its role call does not cover an unused import.
 * @param {import('estree').Node} functionNode
 */
function isRouteHandler(functionNode) {
  const parent = functionNode.parent
  if (!parent)
    return false
  if (parent.type === 'ExportDefaultDeclaration')
    return true
  if (parent.type === 'CallExpression' && parent.arguments.includes(functionNode))
    return parent.parent?.type === 'ExportDefaultDeclaration'
  return false
}

/**
 * @param {import('estree').ImportSpecifier} spec
 */
function importedBindingName(spec) {
  const imported = spec.imported
  if (imported.type === 'Identifier')
    return imported.name
  if (imported.type === 'Literal' && typeof imported.value === 'string')
    return imported.value
  return null
}

/**
 * @param {import('estree').Identifier} node
 */
function isImportBinding(node) {
  const parent = node.parent
  return parent?.type === 'ImportSpecifier'
    || parent?.type === 'ImportDefaultSpecifier'
    || parent?.type === 'ImportNamespaceSpecifier'
}

/**
 * The binding name, not a use. Object patterns are reported by the Property visitor.
 * @param {import('estree').Identifier} node
 */
function isDeclaredName(node) {
  const parent = node.parent
  if (!parent)
    return false
  if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ClassDeclaration' || parent.type === 'ClassExpression') && parent.id === node)
    return true
  if (parent.type === 'VariableDeclarator' && parent.id === node)
    return true
  if ((parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') && parent.params.includes(node))
    return true
  if (parent.type === 'Property' && parent.parent?.type === 'ObjectPattern')
    return true
  if (parent.type === 'ArrayPattern' || parent.type === 'RestElement')
    return true
  if (parent.type === 'AssignmentPattern' && parent.left === node)
    return true
  return false
}

/**
 * @param {import('estree').Identifier} node
 */
function isMemberProperty(node) {
  const parent = node.parent
  return parent?.type === 'MemberExpression' && parent.property === node && !parent.computed
}

/**
 * A shorthand `{ loadInvitationAttempt }` is a use. A key with its own value is not.
 * @param {import('estree').Identifier} node
 */
function isNonShorthandKey(node) {
  const parent = node.parent
  return parent?.type === 'Property' && parent.key === node && !parent.shorthand && !parent.computed
}

/**
 * @param {import('estree').MemberExpression} node
 */
function memberPropertyName(node) {
  if (!node.computed && node.property.type === 'Identifier')
    return node.property.name
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string')
    return node.property.value
  return null
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
          'no-partners-transfers-import': partnersTransfersImport,
          'no-transfers-catalog-deep-import': transfersCatalogDeepImport,
          'no-roster-transfers-import': rosterTransfersImport,
          'no-expiring-documents-transfers-import': expiringDocumentsTransfersImport,
          'no-platform-boundary-import': platformBoundaryImport,
          'capacity-boundary-import': capacityBoundaryImport,
          'worker-loader-role': workerLoaderRole,
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
      'transferpro/no-partners-transfers-import': 'error',
      'transferpro/no-transfers-catalog-deep-import': 'error',
      'transferpro/no-roster-transfers-import': 'error',
      'transferpro/no-expiring-documents-transfers-import': 'error',
      'transferpro/no-platform-boundary-import': 'error',
      'transferpro/capacity-boundary-import': 'error',
      'transferpro/worker-loader-role': 'error',
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
    files: ['server/modules/capacity/domain/**/*.ts', 'server/modules/capacity/application/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', capacityCoreImports],
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
