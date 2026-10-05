import { expect, it } from 'vitest'
import { parseIncludeArchivedQuery, QueryParamError } from './query'

it('reads includeArchived from the query: absent or false hides archived rows, true includes them', () => {
  expect(parseIncludeArchivedQuery(undefined)).toBe(false)
  expect(parseIncludeArchivedQuery('false')).toBe(false)
  expect(parseIncludeArchivedQuery('true')).toBe(true)
  expect(() => parseIncludeArchivedQuery(null)).toThrow(QueryParamError)
  expect(() => parseIncludeArchivedQuery('')).toThrow(QueryParamError)
  expect(() => parseIncludeArchivedQuery(false)).toThrow(QueryParamError)
  expect(() => parseIncludeArchivedQuery(true)).toThrow(QueryParamError)
  expect(() => parseIncludeArchivedQuery('1')).toThrow(QueryParamError)
  expect(() => parseIncludeArchivedQuery('True')).toThrow(QueryParamError)
  expect(() => parseIncludeArchivedQuery(['true'])).toThrow(QueryParamError)
})
