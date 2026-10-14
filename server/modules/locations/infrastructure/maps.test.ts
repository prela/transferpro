import { expect, it } from 'vitest'
import { nodeEnv } from '../../../core/index'
import { FAKE_PLACE_REF, lastTestMapsQuery, mapsForApp, setTestMapsUnavailable } from './maps'
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
  try {
    expect(() => mapsForApp({ MAPS: 'google' })).toThrow('MAPS=google requires MAPS_API_KEY')
  }
  finally {
    restoreNodeEnv(previous)
  }
})
