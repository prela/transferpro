import { postgresErrorCode } from './database-error'
import { getLogger } from './logger'

/**
 * The readiness route throws this. `statusCode` is what the error handler
 * reads. The message is fixed so a connection string on the probe error
 * cannot reach the response.
 */
export class NotReadyError extends Error {
  readonly statusCode = 503

  constructor() {
    super('Not ready')
    this.name = 'NotReadyError'
  }
}

/**
 * Run the database and runtime-role probe. A refusal and a dead connection
 * are the same answer: do not take traffic. The probe error is not attached
 * as `cause`, because node-postgres can put the host on `Error.message`.
 * A role refusal from `assertRuntimeRole` is a fixed sentence with no
 * password, so that sentence may be logged. Anything else is one phrase.
 */
export async function guardReadiness(probe: () => Promise<void>): Promise<void> {
  try {
    await probe()
  }
  catch (error) {
    const detail = error instanceof Error && error.message.startsWith('refusing to start:')
      ? error.message
      : 'readiness check failed'
    try {
      getLogger().error({ code: postgresErrorCode(error) }, detail)
    }
    catch {
      // boot() configures the logger. A probe before that still fails closed.
    }
    throw new NotReadyError()
  }
}
