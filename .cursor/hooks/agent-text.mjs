/**
 * Shared reject list for commit messages and pull-request text.
 * Commit messages use modelProblem only. PR title and body also use footerProblem.
 * Word boundaries avoid ordinary words (corpus, repository). "gpt-4" still matches.
 */

const MODEL = /\bgrok\b|\bgpt\b|\bclaude\b|\bopus\b|\bsonnet\b|\bgemini\b|model\s*:/i

// Substring on purpose: an injected footer comment contains this token.
const FOOTER = /cursor\.com\/agents|cursor_agent/i

/**
 * @param {string} text
 * @returns {string | null} the rejection sentence, or null when the text is clean
 */
export function modelProblem(text) {
  const match = text.match(MODEL)
  if (!match)
    return null
  return `refusing text that names a model (${match[0]}). Rewrite it without a model name or a "Model:" line. See AGENTS.md.`
}

/**
 * @param {string} text
 * @returns {string | null} the rejection sentence, or null when the text is clean
 */
export function footerProblem(text) {
  const match = text.match(FOOTER)
  if (!match)
    return null
  return `refusing text that contains an agent footer or an agent-run link (${match[0]}). See AGENTS.md.`
}
