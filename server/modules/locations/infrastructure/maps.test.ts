import { expect, it } from 'vitest'
import { nodeEnv } from '../../../core/index'
import { FAKE_PLACE_REF, lastTestMapsQuery, mapsForApp, setTestMapsEmbedOff, setTestMapsUnavailable } from './maps'
import { createNoneMaps } from './none-maps'

const text = 'Villa Rosa 12'

function restoreNodeEnv(previous: string | undefined) {
  if (previous === undefined)
    delete process.env.NODE_ENV
  else
    process.env.NODE_ENV = previous
}

it('uses the fake in test even when MAPS=google and a key are set', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  const calls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = async (input) => {
    calls.push(String(input))
    return new Response('no', { status: 200 })
  }
  setTestMapsUnavailable(false)
  try {
    const maps = mapsForApp({ MAPS: 'google', MAPS_API_KEY: 'live-key' })
    const result = await maps.suggestAddresses({
      text,
      sessionToken: 'a1b2c3d4-5555-4555-8555-555555555555',
      language: 'hr',
    })
    expect(result).toMatchObject({
      available: true,
      suggestions: [{ provider: 'google', placeRef: FAKE_PLACE_REF }],
    })
    expect(calls).toEqual([])
    expect(lastTestMapsQuery()?.language).toBe('hr')
  }
  finally {
    globalThis.fetch = original
    restoreNodeEnv(previous)
  }
})

it('answers unavailable when the fake is told to, and when MAPS is none', async () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  try {
    setTestMapsUnavailable(true)
    const maps = mapsForApp({ MAPS: 'none' })
    await expect(maps.suggestAddresses({
      text,
      sessionToken: 'a1b2c3d4-5555-4555-8555-555555555555',
      language: 'en',
    })).resolves.toEqual({ available: false })
  }
  finally {
    setTestMapsUnavailable(false)
    restoreNodeEnv(previous)
  }

  expect(nodeEnv()).not.toBe('production')
  const previousEnv = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    const none = mapsForApp({ MAPS: 'none' })
    await expect(none.suggestAddresses({
      text,
      sessionToken: 'a1b2c3d4-5555-4555-8555-555555555555',
      language: 'hr',
    })).resolves.toEqual({ available: false })
    await expect(createNoneMaps().suggestAddresses({
      text,
      sessionToken: 'a1b2c3d4-5555-4555-8555-555555555555',
      language: 'hr',
    })).resolves.toEqual({ available: false })
  }
  finally {
    restoreNodeEnv(previousEnv)
  }
})

it('refuses to build the Google adapter when the key is missing', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const embedKey = 'embed-secret-value'
  try {
    expect(() => mapsForApp({ MAPS: 'google', MAPS_EMBED_KEY: embedKey })).toThrow('MAPS=google requires MAPS_API_KEY')
    try {
      mapsForApp({ MAPS: 'google', MAPS_EMBED_KEY: embedKey })
    }
    catch (error) {
      expect(String(error)).not.toContain(embedKey)
    }
  }
  finally {
    restoreNodeEnv(previous)
  }
})

const embedTarget = {
  name: 'Hotel & Spa',
  address: 'Put 1, Čilipi',
  archivedAt: null,
  place: { provider: 'google' as const, placeRef: 'ChIJembedPlace' },
}

it('returns an about:blank Embed URL in test under the server MAPS config, and none when Embed is off', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'test'
  setTestMapsEmbedOff(false)
  try {
    // The e2e server leaves MAPS at its existing value, often `none` with
    // no Embed key. The fake still yields a URL and never calls Google.
    const maps = mapsForApp({ MAPS: 'none' })
    const url = maps.embedUrl(embedTarget, 'hr')
    const parsed = new URL(url ?? '')
    expect(`${parsed.protocol}${parsed.pathname}`).toBe('about:blank')
    expect(new URLSearchParams(parsed.hash.slice(1)).get('placeRef')).toBe('ChIJembedPlace')
    expect(new URLSearchParams(parsed.hash.slice(1)).get('language')).toBe('hr')
    expect(url).not.toContain('Hotel')
    expect(url).not.toContain('Čilipi')
    expect(url).not.toContain('key=')
    const withoutKey = mapsForApp({ MAPS: 'google', MAPS_API_KEY: 'live-key' }).embedUrl(embedTarget, 'en')
    expect(withoutKey).toContain('placeRef=ChIJembedPlace')
    expect(withoutKey).toContain('language=en')
    expect(withoutKey).not.toContain('live-key')
    expect(maps.embedUrl({ ...embedTarget, archivedAt: '2026-01-01T00:00:00.000Z' }, 'hr')).toBeNull()
    expect(maps.embedUrl({ ...embedTarget, place: null }, 'hr')).toBeNull()

    setTestMapsEmbedOff(true)
    expect(maps.embedUrl(embedTarget, 'hr')).toBeNull()
  }
  finally {
    setTestMapsEmbedOff(false)
    restoreNodeEnv(previous)
  }
})

it('builds no Embed URL for MAPS=none, and a place URL when google has an Embed key', () => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  try {
    const none = mapsForApp({ MAPS: 'none', MAPS_EMBED_KEY: 'embed-live-key' })
    expect(none.embedUrl(embedTarget, 'hr')).toBeNull()
    const missing = mapsForApp({ MAPS: 'google', MAPS_API_KEY: 'live-key' })
    expect(missing.embedUrl(embedTarget, 'hr')).toBeNull()
    const google = mapsForApp({ MAPS: 'google', MAPS_API_KEY: 'live-key', MAPS_EMBED_KEY: 'embed-live-key' })
    const url = google.embedUrl(embedTarget, 'en')
    const parsed = new URL(url ?? '')
    expect(`${parsed.origin}${parsed.pathname}`).toBe('https://www.google.com/maps/embed/v1/place')
    expect(parsed.searchParams.get('key')).toBe('embed-live-key')
    expect(parsed.searchParams.get('q')).toBe('place_id:ChIJembedPlace')
    expect(url).not.toContain('Hotel')
  }
  finally {
    restoreNodeEnv(previous)
  }
})
