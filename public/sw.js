/**
 * Installability needs a fetch handler. This one does not store anything.
 * Ride responses, and every other response, stay on the network.
 */
globalThis.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET')
    return
  event.respondWith(fetch(event.request))
})
