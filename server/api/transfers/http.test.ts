import { describe, expect, it } from 'vitest'
import { LocationArchivedError } from '../../modules/locations'
import { RideOverlapError, RideUnavailableError, StaleSaveError, TransferNotCorrectableError } from '../../modules/transfers'
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

  it('returns the overlap code and does not keep the guest name', () => {
    const error = thrown(() => transferHttpError(new RideOverlapError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_overlap' },
    })
    expect(JSON.stringify(error)).not.toContain('Ana Anić')
  })

  it('returns the stale-save code and does not keep the guest name', () => {
    const error = thrown(() => transferHttpError(new StaleSaveError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'stale_save' },
    })
    expect(JSON.stringify(error)).not.toContain('Ana Anić')
  })

  it('returns the closed-transfer code and does not keep the guest name', () => {
    const error = thrown(() => transferHttpError(new TransferNotCorrectableError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'transfer_closed' },
    })
    expect(JSON.stringify(error)).not.toContain('Ana Anić')
  })

  it('returns the unavailability code on a judged correction', () => {
    const error = thrown(() => transferHttpError(new RideUnavailableError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_unavailable' },
    })
  })
})
