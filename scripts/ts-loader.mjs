import { existsSync, readFileSync, statSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, resolve as resolvePath } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

/**
 * Resolve extensionless imports to `.ts`, then strip types. Used only by
 * `pnpm tenant:create`. The app itself is built by Nuxt.
 */
export async function resolve(specifier, context, nextResolve) {
  if (isBuiltin(specifier) || (!specifier.startsWith('.') && !specifier.startsWith('/')))
    return nextResolve(specifier, context)

  const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : process.cwd()
  const base = specifier.startsWith('/') ? specifier : resolvePath(dirname(parentPath), specifier)
  const candidates = [base, `${base}.ts`, `${base}.mts`, resolvePath(base, 'index.ts')]
  for (const candidate of candidates) {
    if (!isFile(candidate))
      continue
    if (candidate.endsWith('.ts') || candidate.endsWith('.mts'))
      return { url: pathToFileURL(candidate).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.ts') && !url.endsWith('.mts'))
    return nextLoad(url, context)

  const filename = fileURLToPath(url)
  const source = readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  })
  return {
    format: 'module',
    source: output.outputText,
    shortCircuit: true,
  }
}

function isFile(path) {
  if (!existsSync(path))
    return false
  return statSync(path).isFile()
}
