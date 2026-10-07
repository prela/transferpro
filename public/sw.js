/**
 * Installability needs a fetch handler. Same-origin GET stays on the network.
 * Other methods and other origins are not intercepted. Nothing is stored.
 */
globalThis.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET')
    return
  if (new URL(event.request.url).origin !== globalThis.location.origin)
    return
  event.respondWith(fetch(event.request))
})
