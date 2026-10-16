import { describe, expect, it } from 'vitest'
import { QueryParamError } from '../../../shared'
import { DriverArchivedError } from '../../modules/drivers'
import { driverHttpError, parseIncludeArchived } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('driverHttpError', () => {
  it('returns a distinct code for a correction of an archived Driver', () => {
    const error = thrown(() => driverHttpError(new DriverArchivedError()))
    expect(error).toMatchObject({
      statusCode: 409,
      data: { code: 'driver_archived' },
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
