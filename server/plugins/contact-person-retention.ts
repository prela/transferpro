import { startContactPersonRetention } from '../modules/clients'

/**
 * The daily delete of contact persons removed more than 90 days ago
 * (ADR-0049). Boot has already refused an over-privileged role.
 * Alphabetical order keeps this after `boot.ts`.
 */
export default defineNitroPlugin(async () => {
  await startContactPersonRetention()
})
