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

// A body pr-text accepts: Closes #N plus every template item checked.
// The audit heading keeps the backticks from the pull request template.
const ASVS_CHECKED = `
## OWASP ASVS 5.0 Level 1

### Authentication and session (V7.2.1, V7.4.1)

- [x] reviewed

### Access control, including tenant isolation (V8.2.2)

- [x] reviewed

### Input validation with Zod at the server boundary (V2.2.2)

- [x] n/a — reason: no request body

### Output encoding (V1.2.1)

- [x] reviewed

### Secrets are not in code, logs, or URLs (V14.2.1)

- [x] reviewed

### No personal data in logs (V16.2.5, Level 2)

- [x] reviewed

### \`pnpm audit --audit-level=high\` is green (V15.2.1)

- [x] reviewed

### Error messages leak nothing (V16.5.1, Level 2)

- [x] reviewed
`

/**
 * @param {string} prose
 */
function acceptedBody(prose) {
  return `${prose}\n\nCloses #495\n${ASVS_CHECKED}`
}

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
      PR_BODY: acceptedBody('What changed and why.\n\nHow to test the hooks locally.\n'),
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

test('pull request text rejects redacted names and keeps ordinary words', () => {
  for (const banned of [
    'confirm with Nikša',
    'confirm with Niksa',
    'the Number One fleet',
    'NumberOne dispatch',
    'send it through Solo',
    'imported from Direct Booker',
    'see transferi.kompas.rent',
  ]) {
    const rejected = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PR_TITLE: 'chore: clean title',
        PR_BODY: banned,
      },
    })
    assert.equal(rejected.status, 1, banned)
    assert.match(rejected.stderr, /redacted term/, banned)
  }

  const clean = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: redact names from the charter',
      PR_BODY: acceptedBody('The first Tenant, the reference operator, the fiscalization provider, and email import. Solomon booked a console.'),
    },
  })
  assert.equal(clean.status, 0, clean.stderr)
})

test('pull request text rejects an empty body, a missing Closes line, and an incomplete ASVS checklist', () => {
  for (const body of ['', '   \n\t']) {
    const rejected = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, PR_TITLE: 'chore: ship the wrapper', PR_BODY: body },
    })
    assert.equal(rejected.status, 1, JSON.stringify(body))
    assert.match(rejected.stderr, /empty pull request body/, JSON.stringify(body))
  }

  const prose = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: ship the wrapper',
      PR_BODY: 'What changed and why.\n',
    },
  })
  assert.equal(prose.status, 1)
  assert.match(prose.stderr, /lacks Closes #N/)
  assert.match(prose.stderr, /OWASP ASVS checklist/)

  const closesOnly = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: ship the wrapper',
      PR_BODY: 'Closes #495\n',
    },
  })
  assert.equal(closesOnly.status, 1)
  assert.match(closesOnly.stderr, /OWASP ASVS checklist/)
  assert.doesNotMatch(closesOnly.stderr, /lacks Closes #N/)

  const unchecked = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: ship the wrapper',
      PR_BODY: acceptedBody('What changed.').replace('- [x] reviewed', '- [ ] reviewed'),
    },
  })
  assert.equal(unchecked.status, 1)
  assert.match(unchecked.stderr, /OWASP ASVS checklist/)

  const noCloses = spawnSync('node', ['.cursor/hooks/check-pr-text.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PR_TITLE: 'chore: ship the wrapper',
      PR_BODY: `What changed.\n${ASVS_CHECKED}`,
    },
  })
  assert.equal(noCloses.status, 1)
  assert.match(noCloses.stderr, /lacks Closes #N/)
  assert.doesNotMatch(noCloses.stderr, /OWASP ASVS checklist/)
})
