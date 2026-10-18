import { startMailOutboxWorker } from '../modules/transfers'

/**
 * Retries for the mail outbox. Boot has already refused an over-privileged role.
 * Alphabetical order keeps this after `boot.ts`.
 */
export default defineNitroPlugin(async () => {
  await startMailOutboxWorker()
})
