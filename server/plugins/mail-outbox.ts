import { startMailOutboxRetention } from '../modules/mail'
import { startMailOutboxWorker } from '../modules/transfers'

/**
 * Retries for the mail outbox, and the daily delete of entries older than 90 days.
 * Boot has already refused an over-privileged role.
 * Alphabetical order keeps this after `boot.ts`.
 */
export default defineNitroPlugin(async () => {
  await startMailOutboxWorker()
  await startMailOutboxRetention()
})
