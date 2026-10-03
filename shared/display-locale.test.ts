import { expect, it } from 'vitest'
import { resolveDisplayLocale } from './display-locale'

it('uses the tenant default locale until the user chooses one', () => {
  expect(resolveDisplayLocale(null, 'hr')).toBe('hr')
  expect(resolveDisplayLocale(undefined, 'en')).toBe('en')
  expect(resolveDisplayLocale('', 'hr')).toBe('hr')
  expect(resolveDisplayLocale('nope', 'hr')).toBe('hr')
})

it('keeps a chosen locale over the tenant default', () => {
  expect(resolveDisplayLocale('en', 'hr')).toBe('en')
  expect(resolveDisplayLocale('hr', 'en')).toBe('hr')
})

it('refuses a tenant default that is not hr or en', () => {
  expect(() => resolveDisplayLocale(null, 'de')).toThrow()
})
