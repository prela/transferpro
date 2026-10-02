import type { Logger, LogLevel } from './index'
import { Writable } from 'node:stream'
import { createLogger } from './index'

/**
 * Test sink for the logger. One JSON line in, one object out.
 * Unit and RLS tests share this so the capture shape stays the same.
 */
export function captureLogs(level: LogLevel = 'info'): {
  logger: Logger
  lines: () => Record<string, unknown>[]
} {
  const chunks: string[] = []
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString())
      callback()
    },
  })
  const logger = createLogger({ level, destination })
  return {
    logger,
    lines() {
      return chunks.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Record<string, unknown>)
    },
  }
}
