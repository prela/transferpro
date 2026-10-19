import { describe, expect, it } from 'vitest'
import { UnavailabilityInputError } from '../../../shared'
import { TenantAccessError } from '../../modules/tenancy'
import { UnavailabilityArchivedError, UnavailabilityNotFoundError } from '../../modules/transfers'
import { unavailabilityHttpError } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('unavailabilityHttpError', () => {
  it('answers a bad body, a missing window, and a Driver role with the plain status', () => {
    expect(thrown(() => unavailabilityHttpError(new UnavailabilityInputError()))).toMatchObject({ statusCode: 400 })
    expect(thrown(() => unavailabilityHttpError(new UnavailabilityNotFoundError()))).toMatchObject({ statusCode: 404 })
    expect(thrown(() => unavailabilityHttpError(new TenantAccessError(403)))).toMatchObject({ statusCode: 403 })
  })

  it('returns a distinct code when the Driver or Vehicle is archived', () => {
    expect(thrown(() => unavailabilityHttpError(new UnavailabilityArchivedError()))).toMatchObject({
      statusCode: 409,
      data: { code: 'unavailability_archived' },
    })
  })

  it('passes an unknown error on unchanged', () => {
    const error = new Error('boom')
    expect(thrown(() => unavailabilityHttpError(error))).toBe(error)
  })
})
