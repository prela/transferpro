import { startUnavailabilityRetention } from '../modules/transfers'

/**
 * The daily delete of unavailability windows that ended more than 90 days
 * ago (ADR-0034). Boot has already refused an over-privileged role.
 * Alphabetical order keeps this after `boot.ts`.
 */
export default defineNitroPlugin(async () => {
  await startUnavailabilityRetention()
})
