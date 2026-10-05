/**
 * The same prompt tenant:create uses. The password is never an argument
 * and it is never written out. `--password` is refused by the arg parser
 * before this runs.
 */
import { Buffer } from 'node:buffer'
import process from 'node:process'

export class PasswordPromptError extends Error {
  constructor() {
    super('Password is required.')
    this.name = 'PasswordPromptError'
  }
}

export function readPassword(): Promise<string> {
  if (!process.stdin.isTTY)
    return readPipedPassword()
  return readPromptedPassword()
}

function readPipedPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    process.stdin.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    process.stdin.on('error', reject)
    process.stdin.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      const line = text.split(/\r?\n/, 1)[0] ?? ''
      if (line.length === 0)
        reject(new PasswordPromptError())
      else
        resolve(line)
    })
  })
}

function readPromptedPassword(): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    process.stderr.write('Password: ')
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let password = ''
    function finish(error?: Error, value?: string) {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stderr.write('\n')
      if (error)
        reject(error)
      else if (value !== undefined)
        resolve(value)
    }
    function onData(char: string) {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        if (password.length === 0)
          finish(new PasswordPromptError())
        else
          finish(undefined, password)
        return
      }
      if (char === '\u0003') {
        finish(new PasswordPromptError())
        return
      }
      if (char === '\u007F' || char === '\b') {
        password = password.slice(0, -1)
        return
      }
      if (char < ' ' && char !== '\t')
        return
      password += char
    }
    stdin.on('data', onData)
  })
}
