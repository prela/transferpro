import { describe, expect, it } from 'vitest'
import { LocationArchivedError } from '../../modules/locations'
import { ExtraVehicleCountError, ExtraVehiclePriceError, RideOverlapError, RideUnavailableError, StaleSaveError, TransferNotCorrectableError, TransferNotMainError } from '../../modules/transfers'
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

  it('returns the extra-vehicle codes and does not keep a count', () => {
    const notMain = thrown(() => transferHttpError(new TransferNotMainError()))
    const price = thrown(() => transferHttpError(new ExtraVehiclePriceError()))
    const count = thrown(() => transferHttpError(new ExtraVehicleCountError()))
    expect(notMain).toMatchObject({ statusCode: 409, data: { code: 'transfer_not_main' } })
    expect(price).toMatchObject({ statusCode: 409, data: { code: 'extra_vehicle_price' } })
    expect(count).toMatchObject({ statusCode: 409, data: { code: 'extra_vehicle_count' } })
    expect(JSON.stringify([notMain, price, count])).not.toContain('80')
  })

  it('returns the unavailability code on a judged correction', () => {
    const error = thrown(() => transferHttpError(new RideUnavailableError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_unavailable' },
    })
  })
})
