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

const title = process.env.PR_TITLE ?? ''
const body = process.env.PR_BODY ?? ''
const problems = [
  modelProblem(title),
  modelProblem(body),
  footerProblem(title),
  footerProblem(body),
  bannedProblem(title),
  bannedProblem(body),
].filter(problem => problem !== null)

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exit(1)
}
