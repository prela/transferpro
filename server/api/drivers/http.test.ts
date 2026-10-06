import { describe, expect, it } from 'vitest'
import { QueryParamError } from '../../../shared'
import { parseIncludeArchived } from './http'

function thrown(run: () => unknown): unknown {
  try {
    run()
  }
  catch (error) {
    return error
  }
  throw new Error('expected a throw')
}

describe('parseIncludeArchived', () => {
  it('accepts absent, true, and false and ignores the value', () => {
    expect(parseIncludeArchived(undefined)).toBeUndefined()
    expect(parseIncludeArchived('false')).toBeUndefined()
    expect(parseIncludeArchived(false)).toBeUndefined()
    expect(parseIncludeArchived('true')).toBeUndefined()
    expect(parseIncludeArchived(true)).toBeUndefined()
  })

  it('rejects empty, null, and other loose values with 400', () => {
    for (const raw of ['', null, '1', 'True', 'null', 'yes', 0]) {
      const error = thrown(() => parseIncludeArchived(raw))
      expect(error).toMatchObject({ statusCode: 400 })
      expect(error).not.toBeInstanceOf(QueryParamError)
    }
  })
})
