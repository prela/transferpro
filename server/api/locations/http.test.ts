import { describe, expect, it } from 'vitest'
import { LocationArchivedError } from '../../modules/locations'
import { locationHttpError } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('locationHttpError', () => {
  it('returns a distinct code for a correction of an archived Location', () => {
    const error = thrown(() => locationHttpError(new LocationArchivedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'location_archived' },
    })
    expect(JSON.stringify(error)).not.toContain('Dobrota')
  })
})
