import { expect, it } from 'vitest'
import { createGoogleMaps, GOOGLE_ATTRIBUTION } from './google-maps'

const text = 'Villa Rosa 12, Čilipi'
const sessionToken = 'a1b2c3d4-5555-4555-8555-555555555555'
const placeRef = 'ChIJ68aBlEKuEmsRHUA9oME5Zh0'

function client(answer: { status: number, body: string } | Error) {
  const seen: { url: string, body: string, key: string }[] = []
  return {
    seen,
    http: async (url: string, init: { body: string, headers: Record<string, string>, signal: AbortSignal }) => {
      seen.push({
        url,
        body: init.body,
        key: init.headers['X-Goog-Api-Key'] ?? '',
      })
      if (answer instanceof Error)
        throw answer
      return answer
    },
  }
}

it('sends the session token and the language, and maps the suggestions', async () => {
  const { http, seen } = client({
    status: 200,
    body: JSON.stringify({
      suggestions: [
        {
          placePrediction: {
            placeId: placeRef,
            text: { text: 'Villa Rosa 12, Čilipi, Hrvatska' },
          },
        },
        { queryPrediction: { text: { text: 'villa' } } },
      ],
    }),
  })
  const maps = createGoogleMaps('test-maps-key', http)
  await expect(maps.suggestAddresses({
    text,
    sessionToken,
    language: 'hr',
  })).resolves.toEqual({
    available: true,
    attribution: GOOGLE_ATTRIBUTION,
    suggestions: [{
      text: 'Villa Rosa 12, Čilipi, Hrvatska',
      provider: 'google',
      placeRef,
    }],
  })
  expect(seen).toHaveLength(1)
  expect(seen[0]?.url).toBe('https://places.googleapis.com/v1/places:autocomplete')
  expect(seen[0]?.key).toBe('test-maps-key')
  expect(JSON.parse(seen[0]?.body ?? '{}')).toEqual({
    input: text,
    sessionToken,
    languageCode: 'hr',
  })
})

it('turns an error, a timeout, and a quota answer into unavailable without echoing the text', async () => {
  const cases = [
    { status: 500, body: JSON.stringify({ error: { message: text } }) },
    { status: 429, body: JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: text } }) },
  ]
  for (const answer of cases) {
    const { http } = client(answer)
    const result = await createGoogleMaps('test-maps-key', http).suggestAddresses({
      text,
      sessionToken,
      language: 'en',
    })
    expect(result).toEqual({ available: false })
    expect(JSON.stringify(result)).not.toContain(text)
  }

  const timedOut = client(new Error(`timed out ${text}`))
  const result = await createGoogleMaps('test-maps-key', timedOut.http).suggestAddresses({
    text,
    sessionToken,
    language: 'en',
  })
  expect(result).toEqual({ available: false })
  expect(JSON.stringify(result)).not.toContain(text)
  expect(JSON.stringify(result)).not.toContain('timed out')
})
