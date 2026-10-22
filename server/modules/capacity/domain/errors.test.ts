import { expect, it } from 'vitest'
import { FullyBookedError, RideOverlapError, RideUnavailableError, UnavailabilityArchivedError, UnavailabilityNotFoundError } from './errors'

it('is a 409 ride_overlap with a fixed message that names nobody', () => {
  const error = new RideOverlapError()
  expect(error).toBeInstanceOf(Error)
  expect(error).toMatchObject({ statusCode: 409, code: 'ride_overlap', message: 'Conflict', name: 'RideOverlapError' })
})

it('is a 409 ride_unavailable with a fixed message that holds no instant', () => {
  expect(new RideUnavailableError()).toMatchObject({ statusCode: 409, code: 'ride_unavailable', message: 'Conflict', name: 'RideUnavailableError' })
})

it('is a 409 fully_booked that confirm does not pass, and the message names nobody', () => {
  expect(new FullyBookedError()).toMatchObject({ statusCode: 409, code: 'fully_booked', message: 'Conflict', name: 'FullyBookedError' })
})

it('answers a missing window or resource with a plain 404 and an archived one with a 409', () => {
  expect(new UnavailabilityNotFoundError()).toMatchObject({ statusCode: 404, message: 'Not found' })
  expect(new UnavailabilityArchivedError()).toMatchObject({ statusCode: 409, code: 'unavailability_archived', message: 'Conflict' })
})
