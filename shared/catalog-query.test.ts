import { expect, it } from 'vitest'
import { catalogSearchMatches } from './catalog-query'

it('keeps every row for a blank query and matches a folded substring of any field', () => {
  const fields = ['Hotel Excelsior', 'Hotel', 'Frana Supila 12', '']
  expect(catalogSearchMatches('  ', fields)).toBe(true)
  expect(catalogSearchMatches('', fields)).toBe(true)
  expect(catalogSearchMatches('excelsior', fields)).toBe(true)
  expect(catalogSearchMatches('SUPILA', fields)).toBe(true)
  expect(catalogSearchMatches('čilipi', ['Zračna luka', 'Aerodrom', 'Dobrota bb, Čilipi', 'DBV'])).toBe(true)
  expect(catalogSearchMatches('dbv', ['Zračna luka', 'Aerodrom', 'Dobrota bb, Čilipi', 'DBV'])).toBe(true)
  expect(catalogSearchMatches('agencija', fields)).toBe(false)
})
