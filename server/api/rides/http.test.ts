import { describe, expect, it } from 'vitest'
import { RideNotUnassignedError, RideVehicleArchivedError } from '../../modules/transfers'
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
})
