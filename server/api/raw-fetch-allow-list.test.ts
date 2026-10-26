import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/**
 * Auto-imported `$fetch` carries the office Tenant claim. A raw `fetch(`
 * does not. A new call under `app/` has to be listed here with a reason,
 * or this test fails and names the file.
 */
const rawFetchAllowList: Readonly<Record<string, string>> = {
  'app/components/RideCsvExport.vue': 'GET CSV download. It needs the blob and the content-disposition header, and it writes nothing.',
  'app/plugins/expected-tenant.client.ts': 'Transport of the claimed $fetch. The claim is applied before this call.',
}

const appRoot = fileURLToPath(new URL('../../app/', import.meta.url))

function sourceFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory())
      found.push(...sourceFiles(full))
    else if (/\.(?:vue|[cm]?[jt]s)$/.test(entry) && !/\.test\.[cm]?[jt]s$/.test(entry))
      found.push(full)
  }
  return found
}

function hasRawFetch(source: string): boolean {
  // `$fetch(` and `useFetch(` contain the letters but are not raw fetch.
  const stripped = source.replaceAll('$fetch', '').replaceAll('useFetch', '')
  return /\bfetch\(/.test(stripped)
}

it('fails when a new raw fetch( appears in app/ outside the allow-list', () => {
  const found = sourceFiles(appRoot)
    .filter(file => hasRawFetch(readFileSync(file, 'utf8')))
    .map(file => relative(fileURLToPath(new URL('../..', import.meta.url)), file))
    .sort()
  const allowed = Object.keys(rawFetchAllowList).sort()
  const unexpected = found.filter(file => rawFetchAllowList[file] === undefined)
  expect(unexpected, `raw fetch( outside the allow-list:\n${unexpected.join('\n')}`).toEqual([])
  expect(found, 'an allow-list entry no longer has a raw fetch(').toEqual(allowed)
  for (const reason of Object.values(rawFetchAllowList))
    expect(reason.trim().length).toBeGreaterThan(0)
})
