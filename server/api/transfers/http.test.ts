import { describe, expect, it } from 'vitest'
import { LocationArchivedError } from '../../modules/locations'
import { transferHttpError } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('transferHttpError', () => {
  it('returns the archived-location code and does not keep the guest name', () => {
    const error = thrown(() => transferHttpError(new LocationArchivedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'location_archived' },
    })
    expect(JSON.stringify(error)).not.toContain('Ana Anić')
  })
})
