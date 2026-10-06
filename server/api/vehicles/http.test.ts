import { describe, expect, it } from 'vitest'
import { QueryParamError } from '../../../shared'
import { VehicleArchivedError, VehicleArchivedPlateError, VehiclePlateTakenError } from '../../modules/vehicles'
import { parseIncludeArchived, vehicleHttpError } from './http'

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

describe('parseIncludeArchived', () => {
  it('treats absent and false as hide-archived, and only true includes them', () => {
    expect(parseIncludeArchived(undefined)).toBe(false)
    expect(parseIncludeArchived('false')).toBe(false)
    expect(parseIncludeArchived(false)).toBe(false)
    expect(parseIncludeArchived('true')).toBe(true)
    expect(parseIncludeArchived(true)).toBe(true)
  })

  it('rejects empty, null, and other loose values with 400', () => {
    for (const raw of ['', null, '1', 'True', 'null', 'yes', 0]) {
      const error = thrown(() => parseIncludeArchived(raw))
      expect(error).toMatchObject({ statusCode: 400 })
      expect(error).not.toBeInstanceOf(QueryParamError)
    }
  })
})
