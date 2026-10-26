import { fileURLToPath } from 'node:url'
import { build, loadNuxt } from 'nuxt'
import { expect, it } from 'vitest'
import { liveDollarFetchExport, officeFetchLivePlugin } from './office-fetch-live'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

// Vite resolves Nuxt's virtual fetch template to this id. The build directory
// is either `.nuxt` or `node_modules/.cache/nuxt/.nuxt`; both end in the same file.
const generatedFetchId = `virtual:nuxt:${encodeURIComponent('node_modules/.cache/nuxt/.nuxt/fetch.mjs')}`
const rootBuildFetchId = `virtual:nuxt:${encodeURIComponent('.nuxt/fetch.mjs')}`
const expectedExport = 'export const $fetch = globalThis.$fetch'

function clientPlugin() {
  const plugin = officeFetchLivePlugin()
  const context = { environment: { name: 'client' } }
  return {
    transform(code: string, id: string) {
      return plugin.transform.call(context, code, id)
    },
    buildEnd() {
      plugin.buildEnd.call(context)
    },
  }
}

it('rewrites the fetch module Nuxt generates for this project', async () => {
  const nuxt = await loadNuxt({ cwd: repoRoot, ready: true })
  try {
    // `_prepare` is Nuxt's flag for `nuxi prepare`. It is not on the public
    // options type. Set it so this test generates templates and stops
    // before the client bundle.
    const options = nuxt.options as typeof nuxt.options & { _prepare?: boolean }
    options.dev = false
    options._prepare = true
    await build(nuxt)
    const generated = nuxt.vfs['#build/fetch.mjs']
    if (typeof generated !== 'string')
      throw new Error('Nuxt did not generate #build/fetch.mjs')
    expect(generated).toContain(expectedExport)
    const next = liveDollarFetchExport(generated)
    expect(next).toContain('(...args) => globalThis.$fetch(...args)')
    expect(next).not.toContain(expectedExport)
  }
  finally {
    await nuxt.close()
  }
}, 30_000)

it('leaves a module that is not the generated fetch module alone', () => {
  expect(liveDollarFetchExport('export const other = 1')).toBeUndefined()
  const plugin = clientPlugin()
  expect(plugin.transform('export const $fetch = globalThis.$fetch', 'virtual:nuxt:app%2Ffetch.mjs')).toBeUndefined()
  expect(plugin.transform(expectedExport, '/tmp/ofetch/dist/index.mjs')).toBeUndefined()
})

it('fails the client build when the generated fetch module was not rewritten', () => {
  const plugin = clientPlugin()
  expect(() => plugin.buildEnd()).toThrow(/office-fetch-live/)
  expect(() => plugin.buildEnd()).toThrow(expectedExport)
})

it('fails when the generated fetch module no longer contains the captured export', () => {
  const plugin = clientPlugin()
  expect(() => plugin.transform('export const $fetch = somethingElse', generatedFetchId)).toThrow(/does not contain/)
  expect(() => plugin.transform('export const $fetch = somethingElse', rootBuildFetchId)).toThrow(expectedExport)
  expect(() => plugin.buildEnd()).toThrow(/does not contain/)
})

it('rewrites only the generated fetch module, then lets the client build finish', () => {
  const plugin = clientPlugin()
  const next = plugin.transform(`${expectedExport}\n`, `${generatedFetchId}?t=1`)
  expect(next).toContain('(...args) => globalThis.$fetch(...args)')
  expect(next).not.toContain(expectedExport)
  expect(() => plugin.buildEnd()).not.toThrow()
})

it('does not treat a server rewrite as the client rewrite', () => {
  const plugin = officeFetchLivePlugin()
  plugin.transform.call(
    { environment: { name: 'ssr' } },
    `${expectedExport}\n`,
    generatedFetchId,
  )
  expect(() => plugin.buildEnd.call({ environment: { name: 'ssr' } })).not.toThrow()
  expect(() => plugin.buildEnd.call({ environment: { name: 'client' } })).toThrow(/office-fetch-live/)
})

// A Nuxt 4.6.2 production build with viteEnvironmentApi off still names the
// two Vite builds `client` and `ssr`. A build that omits the name must not
// count as the client one, or a server rewrite would hide a client miss.
it('does not let a rewrite with no environment name satisfy the client build', () => {
  const plugin = officeFetchLivePlugin()
  const rewritten = plugin.transform.call({}, `${expectedExport}\n`, generatedFetchId)
  expect(rewritten).toContain('(...args) => globalThis.$fetch(...args)')
  expect(() => plugin.buildEnd.call({})).toThrow(/did not rewrite/)
  expect(() => plugin.buildEnd.call({ environment: { name: 'client' } })).toThrow(/did not rewrite/)
})
