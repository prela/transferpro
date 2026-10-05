import { describe, expect, it } from 'vitest'
import { RosterDriverTakenError, RosterVehicleArchivedError, RosterVehicleTakenError } from '../../modules/roster'
import { rosterHttpError } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('rosterHttpError', () => {
  it('returns a distinct code when the vehicle is already given that day', () => {
    const error = thrown(() => rosterHttpError(new RosterVehicleTakenError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'roster_vehicle_taken' },
    })
  })

  it('returns a distinct code when the vehicle is archived', () => {
    const error = thrown(() => rosterHttpError(new RosterVehicleArchivedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'roster_vehicle_archived' },
    })
  })

  it('returns a distinct code when the driver already has a row that day', () => {
    const error = thrown(() => rosterHttpError(new RosterDriverTakenError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'roster_driver_taken' },
    })
  })
})
