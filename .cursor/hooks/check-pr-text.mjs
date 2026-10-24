/**
 * GitHub Actions entry. Title and body come from the pull_request event
 * payload via the environment, so the job needs no extra token.
 */
import process from 'node:process'
import { footerProblem, modelProblem } from './agent-text.mjs'

// Proper names and product names stay out of pull-request text.
// Number One and NumberOne are one pattern. A word boundary keeps Solo
// from matching inside another word. Niksa covers the name without the caron.
const BANNED = [
  { pattern: /nikša|niksa/i, label: 'Nikša' },
  { pattern: /number\s*one/i, label: 'Number One' },
  { pattern: /\bsolo\b/i, label: 'Solo' },
  { pattern: /direct\s+booker/i, label: 'Direct Booker' },
  { pattern: /transferi\.kompas\.rent/i, label: 'transferi.kompas.rent' },
]

/**
 * @param {string} text
 * @returns {string | null} the rejection sentence, or null when the text is clean
 */
function bannedProblem(text) {
  for (const { pattern, label } of BANNED) {
    if (pattern.test(text))
      return `refusing text that names a redacted term (${label}). Rewrite it without that name.`
  }
  return null
}

// The Charter checklist, copied from .github/pull_request_template.md.
// An item counts only when the next non-empty line is checked. The blank
// template and a missing section both fail, which is what an empty body on
// PR #493 used to pass.
const ASVS_ITEMS = [
  '### Authentication and session (V7.2.1, V7.4.1)',
  '### Access control, including tenant isolation (V8.2.2)',
  '### Input validation with Zod at the server boundary (V2.2.2)',
  '### Output encoding (V1.2.1)',
  '### Secrets are not in code, logs, or URLs (V14.2.1)',
  '### No personal data in logs (V16.2.5, Level 2)',
  '### `pnpm audit --audit-level=high` is green (V15.2.1)',
  '### Error messages leak nothing (V16.5.1, Level 2)',
]

const CHECKED_ITEM = /^- \[x\] (?:reviewed|n\/a — reason: \S.*)$/i

/**
 * @param {string} body
 * @returns {string | null} the rejection sentence, or null when every checklist item is checked
 */
function asvsProblem(body) {
  if (!body.includes('## OWASP ASVS 5.0 Level 1'))
    return 'refusing a pull request body that lacks the OWASP ASVS checklist.'
  const lines = body.split(/\r?\n/)
  for (const item of ASVS_ITEMS) {
    const index = lines.findIndex(line => line.trim() === item)
    if (index === -1)
      return 'refusing a pull request body that lacks the OWASP ASVS checklist.'
    let cursor = index + 1
    while (cursor < lines.length && lines[cursor].trim() === '')
      cursor++
    if (!CHECKED_ITEM.test((lines[cursor] ?? '').trim()))
      return 'refusing a pull request body that lacks the OWASP ASVS checklist.'
  }
  return null
}

/**
 * Empty fails on its own. A non-empty body must have Closes #N and a
 * completed checklist; both gaps are reported together.
 * @param {string} body
 * @returns {string[]} rejection sentences, empty when the body is acceptable
 */
function bodyProblems(body) {
  if (body.trim() === '')
    return ['refusing an empty pull request body.']
  const problems = []
  if (!/closes #\d+/i.test(body))
    problems.push('refusing a pull request body that lacks Closes #N.')
  const asvs = asvsProblem(body)
  if (asvs !== null)
    problems.push(asvs)
  return problems
}

const title = process.env.PR_TITLE ?? ''
const body = process.env.PR_BODY ?? ''
const problems = [
  modelProblem(title),
  modelProblem(body),
  footerProblem(title),
  footerProblem(body),
  bannedProblem(title),
  bannedProblem(body),
  ...bodyProblems(body),
].filter(problem => problem !== null)

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exit(1)
}
