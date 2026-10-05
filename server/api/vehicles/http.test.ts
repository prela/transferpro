import { describe, expect, it } from 'vitest'
import { VehicleArchivedError, VehicleArchivedPlateError, VehiclePlateTakenError } from '../../modules/vehicles'
import { vehicleHttpError } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('vehicleHttpError', () => {
  it('returns a distinct code for a live plate conflict', () => {
    const error = thrown(() => vehicleHttpError(new VehiclePlateTakenError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'vehicle_plate_taken' },
    })
  })

  it('returns a distinct code for an archived plate conflict', () => {
    const error = thrown(() => vehicleHttpError(new VehicleArchivedPlateError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'vehicle_archived_plate' },
    })
  })

  it('returns a distinct code for a correction of an archived Vehicle', () => {
    const error = thrown(() => vehicleHttpError(new VehicleArchivedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'vehicle_archived' },
    })
  })
})
