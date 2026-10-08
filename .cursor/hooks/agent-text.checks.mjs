/**
 * Commit-message and pull-request text checks.
 * Run: node --test .cursor/hooks/agent-text.checks.mjs
 * The name is `.checks.mjs`, not `.test.mjs`: ESLint rewrites `node:test` to vitest in test files.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { footerProblem, modelProblem } from './agent-text.mjs'

test('model names and a Model line are rejected; ordinary prose is not', () => {
  for (const text of [
    'implemented with grok',
    'Uses GPT-4',
    'thanks claude',
    'switch to Opus',
    'Sonnet wrote this',
    'gemini summary',
    'Model: something',
    'model : something',
  ]) {
    assert.ok(modelProblem(text), text)
  }
  for (const text of [
    'chore: add the shell guard',
    'the data model stays in the glossary',
    'corpus and repository',
    'chatgpt is one word here',
  ]) {
    assert.equal(modelProblem(text), null, text)
  }
})

test('agent footer and agent-run links are rejected only by the footer check', () => {
  assert.ok(footerProblem('see cursor.com/agents/abc'))
  assert.ok(footerProblem('<!-- CURSOR_AGENT_PR_BODY_BEGIN -->'))
  assert.equal(footerProblem('chore: add the shell guard'), null)
  assert.equal(modelProblem('<!-- CURSOR_AGENT_PR_BODY_BEGIN -->'), null)
})

test('commit-msg hook exits 1 on a model name and 0 on a clean message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-commit-msg-'))
  const bad = path.join(dir, 'bad.txt')
  const good = path.join(dir, 'good.txt')
  fs.writeFileSync(bad, 'feat: ask grok\n')
  fs.writeFileSync(good, 'chore: add agent rules and a shell guard\n')
  try {
    const rejected = spawnSync('node', ['.cursor/hooks/check-commit-msg.mjs', bad], { encoding: 'utf8' })
    assert.equal(rejected.status, 1)
    assert.match(rejected.stderr, /commit-msg:/)

    const accepted = spawnSync('node', ['.cursor/hooks/check-commit-msg.mjs', good], { encoding: 'utf8' })
    assert.equal(accepted.status, 0, accepted.stderr)
  }
  finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('pull request text check reads the event payload from the environment', () => {
  const clean = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: agent rules and guard hooks',
      PR_BODY: 'What changed and why.\n\nHow to test the hooks locally.\n',
    },
  })
  assert.equal(clean.status, 0, clean.stderr)

  const named = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: clean title',
      PR_BODY: 'Generated with grok.',
    },
  })
  assert.equal(named.status, 1)
  assert.match(named.stderr, /names a model/)

  const footer = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: clean title',
      PR_BODY: 'Link: cursor.com/agents/1',
    },
  })
  assert.equal(footer.status, 1)
  assert.match(footer.stderr, /agent footer/)
})
