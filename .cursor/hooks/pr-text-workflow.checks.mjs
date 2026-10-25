/**
 * The pr-text workflow has no path filter, so a docs-only pull request still runs it.
 * Run: node --test .cursor/hooks/pr-text-workflow.checks.mjs
 * The name is `.checks.mjs`, not `.test.mjs`: ESLint rewrites `node:test` to vitest in test files.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const prText = fs.readFileSync('.github/workflows/pr-text.yml', 'utf8')
const guard = fs.readFileSync('.github/workflows/agent-guard.yml', 'utf8')
const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8')

test('pr-text runs on every pull request, including a docs-only diff', () => {
  assert.equal(prText.includes('paths-ignore'), false)
  assert.match(prText, /types: \[opened, edited, synchronize, reopened\]/)
  assert.match(prText, /PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/)
  assert.match(prText, /PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/)
  assert.match(prText, /node \.cursor\/hooks\/check-pr-text\.mjs/)
})

test('agent-guard and ci keep their path filters, and pr-text is its own workflow', () => {
  assert.match(guard, /paths-ignore:/)
  assert.doesNotMatch(guard, /^ {2}pr-text:/m)
  assert.match(ci, /paths-ignore:/)
  assert.doesNotMatch(ci, /check-pr-text\.mjs/)
})
