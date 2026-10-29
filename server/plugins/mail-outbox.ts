import { startInvoiceCreateWorker } from '../modules/invoicing'
import { startMailOutboxRetention } from '../modules/mail'
import { mailOutboxQueue, startMailOutboxWorker } from '../modules/transfers'

/**
 * Retries for the mail outbox, and the daily delete of entries older than 90 days.
 * Boot has already refused an over-privileged role.
 * Alphabetical order keeps this after `boot.ts`.
 */
export default defineNitroPlugin(async () => {
  await startMailOutboxWorker()
  await startInvoiceCreateWorker(await mailOutboxQueue())
  await startMailOutboxRetention()
})
