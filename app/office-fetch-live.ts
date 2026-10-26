/**
 * Nuxt writes `export const $fetch = globalThis.$fetch` into the generated
 * fetch module. That copies the function once, before plugins run, so a
 * later assignment to `globalThis.$fetch` would not reach auto-imported
 * `$fetch` or `useRequestFetch`. This turns the export into a call through
 * the current global, which the expected-tenant plugin replaces.
 *
 * The string is the one Nuxt's `fetch.mjs` template emits today. A client
 * build fails when the template is missing or no longer contains it, so a
 * Nuxt upgrade cannot drop the office Tenant claim silently.
 */
const capturedExport = 'export const $fetch = globalThis.$fetch'

const liveExport = `const officeFetchCaller = (...args) => globalThis.$fetch(...args)
officeFetchCaller.raw = (...args) => globalThis.$fetch.raw(...args)
officeFetchCaller.create = (...args) => globalThis.$fetch.create(...args)
officeFetchCaller.native = (...args) => globalThis.$fetch.native(...args)
export const $fetch = officeFetchCaller`

/**
 * Nuxt's virtual plugin resolves the template to `virtual:nuxt:` plus the
 * path of `fetch.mjs` inside the build directory. That directory is `.nuxt`
 * or `node_modules/.cache/nuxt/.nuxt`. Either path ends in this suffix.
 * A query string from Vite is ignored. Any other id, including one that
 * merely contains "fetch", is left alone.
 */
const generatedFetchSuffix = '/.nuxt/fetch.mjs'
const virtualPrefix = 'virtual:nuxt:'

interface OfficeFetchBuild {
  environment?: { name?: string }
}

export function liveDollarFetchExport(code: string): string | undefined {
  if (!code.includes(capturedExport))
    return undefined
  return code.replace(capturedExport, liveExport)
}

function isGeneratedFetchModuleId(id: string): boolean {
  const bare = id.replace(/^\0/, '').split('?')[0] ?? ''
  const encoded = bare.startsWith(virtualPrefix) ? bare.slice(virtualPrefix.length) : bare
  const normalized = decodeURIComponent(encoded).replaceAll('\\', '/')
  return normalized === '.nuxt/fetch.mjs' || normalized.endsWith(generatedFetchSuffix)
}

function environmentName(context: OfficeFetchBuild): string {
  return context.environment?.name ?? 'client'
}

function missingExportError(): Error {
  return new Error(
    `office-fetch-live: the generated fetch module does not contain \`${capturedExport}\`. Auto-imported $fetch would keep the function captured before the expected-tenant plugin replaces globalThis.$fetch.`,
  )
}

/**
 * Vite plugin. `buildEnd` runs for a production build, not for `nuxt dev`.
 * Client and server builds share one plugin object, so a server rewrite
 * must not count as the client one. A transform error can be reported as
 * the later `buildEnd` error, so a module that was seen without the export
 * fails again there with the same message.
 */
export function officeFetchLivePlugin() {
  const rewritten = new Set<string>()
  const missingExport = new Set<string>()
  return {
    name: 'office-fetch-live',
    enforce: 'pre' as const,
    transform(this: OfficeFetchBuild, code: string, id: string) {
      if (!isGeneratedFetchModuleId(id))
        return
      const next = liveDollarFetchExport(code)
      if (next === undefined) {
        missingExport.add(environmentName(this))
        throw missingExportError()
      }
      rewritten.add(environmentName(this))
      return next
    },
    buildEnd(this: OfficeFetchBuild) {
      const name = environmentName(this)
      if (name !== 'client')
        return
      if (missingExport.has('client'))
        throw missingExportError()
      if (!rewritten.has('client')) {
        throw new Error(
          `office-fetch-live: the client build did not rewrite the generated fetch module. Expected to replace \`${capturedExport}\`.`,
        )
      }
    },
  }
}
