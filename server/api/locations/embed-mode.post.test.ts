import { createApp, toWebHandler } from 'h3'
import { afterEach, expect, it } from 'vitest'
import { mapsForApp, setTestMapsEmbedOff } from '../../modules/locations'
import postEmbedMode from './embed-mode.post'

/**
 * The switch is the route. Outside test it is 404 and does not flip the
 * fake. Inside test it is the only way a suite turns the Embed off.
 */

const app = createApp()
app.use('/api/locations/embed-mode', event => postEmbedMode(event))
const call = toWebHandler(app)

const target = {
  name: 'Hotel & Spa',
  address: 'Put 1, Čilipi',
  archivedAt: null,
  place: { provider: 'google' as const, placeRef: 'ChIJembedPlace' },
}

function restoreNodeEnv(previous: string | undefined) {
  if (previous === undefined)
    delete process.env.NODE_ENV
  else
    process.env.NODE_ENV = previous
}

afterEach(() => {
  setTestMapsEmbedOff(false)
})

function post(body: unknown) {
  return call(new Request('http://localhost/api/locations/embed-mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

it('is 404 outside test and does not turn the Embed off', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    const response = await post({ off: true })
    expect(response.status).toBe(404)
  }
  finally {
    restoreNodeEnv(previous)
  }
  const maps = mapsForApp({ MAPS: 'google', MAPS_API_KEY: 'places-key', MAPS_EMBED_KEY: 'embed-live-key' })
  expect(maps.embedUrl(target, 'hr')).toContain('about:blank#')
})

it('accepts the switch in test and refuses a body that is not off', async () => {
  const bad = await post({ unavailable: true })
  expect(bad.status).toBe(400)

  const off = await post({ off: true })
  expect(off.status).toBe(200)
  expect(await off.json()).toEqual({ off: true })
  const maps = mapsForApp({ MAPS: 'google', MAPS_API_KEY: 'places-key', MAPS_EMBED_KEY: 'embed-live-key' })
  expect(maps.embedUrl(target, 'hr')).toBeNull()

  const on = await post({ off: false })
  expect(on.status).toBe(200)
  expect(maps.embedUrl(target, 'en')).toContain('language=en')
})
