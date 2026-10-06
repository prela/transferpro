/**
 * Husky commit-msg entry. Argument 1 is the message file git passes.
 */
import fs from 'node:fs'
import process from 'node:process'
import { modelProblem } from './agent-text.mjs'

const file = process.argv[2]
if (!file) {
  process.stderr.write('commit-msg: missing message file\n')
  process.exit(1)
}

const problem = modelProblem(fs.readFileSync(file, 'utf8'))
if (problem) {
  process.stderr.write(`commit-msg: ${problem}\n`)
  process.exit(1)
}
