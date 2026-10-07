/**
 * Registers the network-only worker so a production build can be installed.
 * Dev skips it. The worker does not cache ride data. A failed registration leaves the page usable.
 */
export default defineNuxtPlugin(() => {
  if (import.meta.dev)
    return
  if (!('serviceWorker' in navigator))
    return
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // The page still works when the worker cannot register.
  })
})
