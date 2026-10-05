import { boot } from '../core/index'

/**
 * Nitro starts this before it serves.
 * An over-privileged app, auth, queue, or platform role throws and the process stops.
 */
export default defineNitroPlugin(async () => {
  await boot()
})
