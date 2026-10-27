import { createApp, toWebHandler } from 'h3'
import { expect, it } from 'vitest'
import { mapsForApp, setTestMapsUnavailable, TEST_SUGGESTIONS_UNAVAILABLE_COOKIE } from '../../modules/locations'
import postSuggestionsMode from './suggestions-mode.post'

const app = createApp()
app.use('/api/locations/suggestions-mode', event => postSuggestionsMode(event))
const call = toWebHandler(app)

it('marks the caller and leaves the shared fake available', async () => {
  setTestMapsUnavailable(false)
  const response = await call(new Request('http://localhost/api/locations/suggestions-mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ unavailable: true }),
  }))
  expect(response.status).toBe(200)
  const set = response.headers.getSetCookie().map(part => part.split(';')[0]).join('; ')
  expect(set).toContain(`${TEST_SUGGESTIONS_UNAVAILABLE_COOKIE}=1`)
  const maps = mapsForApp({ MAPS: 'none' })
  await expect(maps.suggestAddresses({
    text: 'Put 4',
    sessionToken: 'c1b2c3d4-5555-4555-8555-555555555555',
    language: 'hr',
  })).resolves.toMatchObject({ available: true })
})
