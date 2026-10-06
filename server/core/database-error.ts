import type { Logger } from './logger'
import { getLogger } from './logger'

/** Postgres SQLSTATE is five characters (for example `23505`). */
const sqlState = /^[0-9A-Z]{5}$/

/**
 * The SQLSTATE on this error or a wrapped cause. Drizzle copies bound
 * values into `Error.message`, so callers must not log that text.
 */
export function postgresErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && typeof current.code === 'string' && sqlState.test(current.code))
      return current.code
    current = 'cause' in current ? current.cause : undefined
  }
  return undefined
}

function writeFailure(failure: string, error: unknown, logger: Logger | undefined): void {
  const code = postgresErrorCode(error)
  if (logger) {
    logger.error({ code }, failure)
    return
  }
  try {
    getLogger().error({ code }, failure)
  }
  catch {
    // Unit tests that never boot have no process logger.
  }
}

/**
 * Run one database step. A failure becomes `failure` so bound ids never
 * reach the log. The Postgres SQLSTATE is logged alone. Domain errors the
 * caller names in `passthrough` keep their type.
 */
export async function hideDatabaseError<T>(
  step: () => Promise<T>,
  failure: string,
  options?: {
    passthrough?: (error: unknown) => boolean
    logger?: Logger
  },
): Promise<T> {
  try {
    return await step()
  }
  catch (error) {
    if (options?.passthrough?.(error))
      throw error
    writeFailure(failure, error, options?.logger)
    throw new Error(failure)
  }
}
