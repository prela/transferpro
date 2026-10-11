import { startFlightLandingWorker } from '../modules/transfers'

/**
 * The landing-time ask. Boot has already refused an over-privileged role.
 * Alphabetical order keeps this after `boot.ts`.
 */
export default defineNitroPlugin(async () => {
  await startFlightLandingWorker()
})
