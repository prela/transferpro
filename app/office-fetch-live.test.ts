import { expect, it } from 'vitest'
import { liveDollarFetchExport } from './office-fetch-live'

const generated = `import { $fetch as _$fetch } from 'ofetch'
if (!globalThis.$fetch) {
  globalThis.$fetch = _$fetch.create({ baseURL: '/' })
}
export const $fetch = globalThis.$fetch
`

it('makes the generated $fetch call the current global instead of a captured one', () => {
  const next = liveDollarFetchExport(generated)
  expect(next).toContain('(...args) => globalThis.$fetch(...args)')
  expect(next).not.toContain('export const $fetch = globalThis.$fetch')
  expect(liveDollarFetchExport('export const other = 1')).toBeUndefined()
})
