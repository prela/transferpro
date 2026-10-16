import { expect, it } from 'vitest'
import { QueryParamError } from './query'
import { parseTransferSearchQuery, TRANSFER_SEARCH_MAX_LENGTH } from './transfer-search'

it('accepts a trimmed search query inside the length bounds', () => {
  expect(parseTransferSearchQuery('  OU392  ')).toBe('OU392')
  expect(parseTransferSearchQuery('a'.repeat(TRANSFER_SEARCH_MAX_LENGTH))).toBe('a'.repeat(TRANSFER_SEARCH_MAX_LENGTH))
})

it('refuses a missing, blank, or over-long search query and does not keep the text', () => {
  expect(TRANSFER_SEARCH_MAX_LENGTH).toBe(200)
  expect(() => parseTransferSearchQuery(undefined)).toThrow(QueryParamError)
  expect(() => parseTransferSearchQuery('')).toThrow(QueryParamError)
  expect(() => parseTransferSearchQuery('   ')).toThrow(QueryParamError)
  expect(() => parseTransferSearchQuery('a'.repeat(TRANSFER_SEARCH_MAX_LENGTH + 1))).toThrow(QueryParamError)
  expect(() => parseTransferSearchQuery(null)).toThrow(QueryParamError)
  expect(() => parseTransferSearchQuery(['Ana'])).toThrow(QueryParamError)
  expect(() => parseTransferSearchQuery(1)).toThrow(QueryParamError)

  const refused = `Q7-secret-query${'x'.repeat(TRANSFER_SEARCH_MAX_LENGTH)}`
  expect(() => parseTransferSearchQuery(refused)).toThrow(QueryParamError)
  try {
    parseTransferSearchQuery(refused)
  }
  catch (error) {
    expect(JSON.stringify(error)).not.toContain('Q7-secret-query')
    expect((error as Error).message).toBe('Bad request')
  }
})
