import type { JobQueue, Logger } from '../../../core/index'
import type { InvitationMailPort } from '../../tenancy'
import type { OutboxSender } from '../application/attempt'
import type { InvitationReader } from './invitation-attempt'
import { getLogger, loadAppEnv } from '../../../core/index'
import { mailerForApp } from '../../tenancy'
import { enqueueMailOutboxJob, firstOutboxAttempt } from '../application/attempt'
import { deliverNewInvitation } from '../application/invitation'
import { MAIL_RETRY_DELAYS_MS } from '../domain/retry'
import { invitationAttemptStore } from './invitation-attempt'
import { recordInvitation } from './outbox'
import { mailOutboxQueue } from './queue'

/**
 * The invite call's mail. The entry and its one-minute job commit on one
 * tenant transaction. The first attempt runs on another, and the invite
 * call waits for it. The queued job is the retry, so a failed first attempt
 * queues nothing more. Tests pass a fake mailer, a log, a clock, a queue,
 * or a reader. The defaults are the app's.
 */
export function invitationMailOutbox(deps: {
  readonly mailer?: OutboxSender
  readonly log?: Logger
  readonly now?: () => Date
  readonly queue?: JobQueue
  readonly read?: InvitationReader
} = {}): InvitationMailPort {
  return {
    async deliver({ context, invitationId, open }) {
      const log = deps.log ?? getLogger()
      const now = deps.now ?? (() => new Date())
      return deliverNewInvitation({
        log,
        record: async () => {
          const queue = deps.queue ?? await mailOutboxQueue()
          return open(async (transaction) => {
            const nextAttemptAt = new Date(now().getTime() + MAIL_RETRY_DELAYS_MS[0])
            const entryId = await recordInvitation(transaction, invitationId, nextAttemptAt)
            await enqueueMailOutboxJob(queue, context, transaction, entryId, nextAttemptAt)
            return entryId
          })
        },
        attempt: entryId => open(transaction => firstOutboxAttempt({
          entryId,
          store: invitationAttemptStore(transaction, context, deps.read),
          mailer: deps.mailer ?? mailerForApp(loadAppEnv()),
          now: now(),
          log,
        })),
      })
    },
  }
}
