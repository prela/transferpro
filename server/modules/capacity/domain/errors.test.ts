import { expect, it } from 'vitest'
import { RideOverlapError } from './errors'

it('is a 409 ride_overlap with a fixed message that names nobody', () => {
  const error = new RideOverlapError()
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ statusCode: 409, code: 'ride_overlap', message: 'Conflict', name: 'RideOverlapError' })
})
