/**
 * Nuxt writes `export const $fetch = globalThis.$fetch` into the generated
 * fetch module. That copies the function once, before plugins run, so a
 * later assignment to `globalThis.$fetch` would not reach auto-imported
 * `$fetch` or `useRequestFetch`. This turns the export into a call through
 * the current global, which the expected-tenant plugin replaces.
 */
const capturedExport = 'export const $fetch = globalThis.$fetch'

const liveExport = `const officeFetchCaller = (...args) => globalThis.$fetch(...args)
officeFetchCaller.raw = (...args) => globalThis.$fetch.raw(...args)
officeFetchCaller.create = (...args) => globalThis.$fetch.create(...args)
officeFetchCaller.native = (...args) => globalThis.$fetch.native(...args)
export const $fetch = officeFetchCaller`

export function liveDollarFetchExport(code: string): string | undefined {
  if (!code.includes(capturedExport))
    return undefined
  return code.replace(capturedExport, liveExport)
}
