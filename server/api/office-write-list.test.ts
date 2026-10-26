import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { isOfficeWrite, officeWriteExemption } from '../../shared'

/**
 * Every write handler is an office write or an exemption with a reason.
 * A new file that is neither fails this test, and the message names it.
 * The sample id is only so `[id]` can be matched against the route regex.
 */
const sampleId = '00000000-0000-4000-8000-000000000001'
const apiRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

function writeHandlers(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry)
    if (statSync(full).isDirectory())
      found.push(...writeHandlers(full))
    else if (/\.(?:post|put|patch|delete)\.ts$/.test(entry))
      found.push(relative(apiRoot, full))
  }
  return found
}

function routeOf(file: string): { method: string, path: string } {
  const matched = file.match(/^(.*)\.(post|put|patch|delete)\.ts$/)
  if (!matched)
    throw new Error(`not a write handler: ${file}`)
  let route = matched[1] ?? ''
  if (route.endsWith('/index'))
    route = route.slice(0, -'/index'.length)
  route = route.replace(/\[[^\]]+\]/g, sampleId)
  return { method: (matched[2] ?? '').toUpperCase(), path: `/api/${route}` }
}

it('classifies every office write handler, and names a file that is neither listed nor exempt', () => {
  const files = writeHandlers(apiRoot)
  expect(files.length).toBeGreaterThan(0)
  const unmatched = files.filter((file) => {
    const route = routeOf(file)
    return !isOfficeWrite(route.method, route.path) && officeWriteExemption(route.method, route.path) === undefined
  })
  expect(unmatched, `unclassified write handlers:\n${unmatched.join('\n')}`).toEqual([])

  const resend = routeOf('office-home/failed-mail/[entryId]/resend.post.ts')
  expect(isOfficeWrite(resend.method, resend.path)).toBe(true)
  const choice = routeOf('tenant-choices.post.ts')
  expect(officeWriteExemption(choice.method, choice.path)).toBeTruthy()
})

it('keeps the screen Tenant claim off an inline script and off a fetch patch', () => {
  const config = readFileSync(join(repoRoot, 'nuxt.config.ts'), 'utf8')
  expect(config).not.toContain('innerHTML')
  expect(config).not.toContain('__transferproFetch')
  const plugin = readFileSync(join(repoRoot, 'app/plugins/expected-tenant.client.ts'), 'utf8')
  expect(plugin).not.toContain('__transferproFetch')
  expect(plugin).not.toContain('window.fetch =')
})
