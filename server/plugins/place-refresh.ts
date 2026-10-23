import { startPlaceRefreshWorker } from '../modules/locations'

/**
 * The nightly place-reference check (ADR-0052). Boot has already refused
 * an over-privileged role. `MAPS=none` registers nothing.
 * Alphabetical order keeps this after `boot.ts`.
 */
export default defineNitroPlugin(async () => {
  await startPlaceRefreshWorker()
})
