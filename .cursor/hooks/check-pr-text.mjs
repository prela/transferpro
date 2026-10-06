/**
 * GitHub Actions entry. Title and body come from the pull_request event
 * payload via the environment, so the job needs no extra token.
 */
import process from 'node:process'
import { footerProblem, modelProblem } from './agent-text.mjs'

const title = process.env.PR_TITLE ?? ''
const body = process.env.PR_BODY ?? ''
const problems = [
  modelProblem(title),
  modelProblem(body),
  footerProblem(title),
  footerProblem(body),
].filter(problem => problem !== null)

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`)
  process.exit(1)
}
