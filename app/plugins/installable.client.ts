/**
 * Registers the network-only worker so the app can be installed.
 * The worker does not cache ride data. A failed registration leaves the page usable.
 */
export default defineNuxtPlugin(() => {
  if (!('serviceWorker' in navigator))
    return
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    // The page still works when the worker cannot register.
  })
})
