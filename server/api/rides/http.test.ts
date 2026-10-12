import { describe, expect, it } from 'vitest'
import { RideNotAcceptableError, RideNotCancellableError, RideNotOpenError, RideNotUnassignedError, RideSameDriverError, RideVehicleArchivedError, RideVehicleUnchangedError } from '../../modules/transfers'
import { rideHttpError } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('rideHttpError', () => {
  it('returns a distinct code when the vehicle is archived', () => {
    const error = thrown(() => rideHttpError(new RideVehicleArchivedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_vehicle_archived' },
    })
  })

  it('returns a distinct code when the ride is not unassigned', () => {
    const error = thrown(() => rideHttpError(new RideNotUnassignedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_not_unassigned' },
    })
  })

  it('returns a distinct code when the ride cannot be accepted', () => {
    const error = thrown(() => rideHttpError(new RideNotAcceptableError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_not_acceptable' },
    })
  })

  it('returns a distinct code when the ride is not open for a vehicle change, a clear, or a reassignment', () => {
    const error = thrown(() => rideHttpError(new RideNotOpenError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_not_open' },
    })
  })

  it('returns a distinct code when the vehicle is already the one on the ride', () => {
    const error = thrown(() => rideHttpError(new RideVehicleUnchangedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_vehicle_unchanged' },
    })
  })

  it('returns a distinct code when the ride cannot be cancelled', () => {
    const error = thrown(() => rideHttpError(new RideNotCancellableError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_not_cancellable' },
    })
  })

  it('returns a distinct code when the reassignment names the same driver', () => {
    const error = thrown(() => rideHttpError(new RideSameDriverError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'ride_same_driver' },
    })
  })
})
