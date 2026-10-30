import { startInvoiceStatusWorker } from '../modules/invoicing'

/**
 * The invoice status tick. Boot has already refused an over-privileged role.
 * Alphabetical order keeps this after `boot.ts`. `INVOICING=none` returns
 * before a queue exists.
 */
export default defineNitroPlugin(async () => {
  await startInvoiceStatusWorker()
})
