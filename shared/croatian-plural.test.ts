import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { croatianPluralIndex } from './croatian-plural'

/**
 * CLDR Croatian: one, few, other. The catalog uses that order, so the
 * index is the form a three-way message picks.
 */
const category = (choice: number) => croatianPluralIndex(choice, 3)

it('picks the Croatian plural for one, few, and other', () => {
  expect(category(1)).toBe(0)
  expect(category(21)).toBe(0)
  expect(category(2)).toBe(1)
  expect(category(4)).toBe(1)
  expect(category(22)).toBe(1)
  expect(category(5)).toBe(2)
  expect(category(11)).toBe(2)
  expect(category(12)).toBe(2)
  expect(category(14)).toBe(2)

  const forms = ['na {n} vožnji', 'na {n} vožnje', 'na {n} vožnji']
  const phrase = (n: number) => forms[category(n)]!.replaceAll('{n}', String(n))
  expect(phrase(1)).toBe('na 1 vožnji')
  expect(phrase(3)).toBe('na 3 vožnje')
  expect(phrase(5)).toBe('na 5 vožnji')
})

it('keeps a two-form message on one and other, and a message with no plural on its only text', () => {
  expect(croatianPluralIndex(1, 2)).toBe(0)
  expect(croatianPluralIndex(2, 2)).toBe(1)
  expect(croatianPluralIndex(5, 2)).toBe(1)
  expect(croatianPluralIndex(11, 2)).toBe(1)
  expect(croatianPluralIndex(21, 2)).toBe(0)
  expect(croatianPluralIndex(1, 1)).toBe(0)
  expect(croatianPluralIndex(5, 1)).toBe(0)

  const hr = JSON.parse(readFileSync(new URL('../i18n/locales/hr.json', import.meta.url), 'utf8')) as {
    transfers: { corrected: string }
  }
  const en = JSON.parse(readFileSync(new URL('../i18n/locales/en.json', import.meta.url), 'utf8')) as {
    transfers: { corrected: string }
  }
  expect(hr.transfers.corrected).toBe('Ispravljeno.')
  expect(en.transfers.corrected).toBe('Corrected.')
})
