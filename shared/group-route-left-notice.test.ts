import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { croatianPluralIndex } from './croatian-plural'
import { groupRouteLeftNotice } from './group-route-left-notice'

/**
 * The same pipe split and plural index vue-i18n applies. Named `count`
 * selects the form, which is what `t(key, { count }, count)` does. Expected
 * sentences are the issue's copy, not a second copy of the catalog.
 */
function noticeTranslator(locale: 'hr' | 'en') {
  const catalog = JSON.parse(readFileSync(new URL(`../i18n/locales/${locale}.json`, import.meta.url), 'utf8')) as {
    transfers: Record<string, string>
  }
  return (key: string, named?: Record<string, string | number>, choice?: number) => {
    const raw = catalog.transfers[key.slice('transfers.'.length)] ?? ''
    const forms = raw.split(' | ')
    const count = typeof named?.count === 'number' ? named.count : choice
    const index = forms.length < 2 || count === undefined
      ? 0
      : locale === 'hr'
        ? croatianPluralIndex(count, forms.length)
        : count === 1 ? 0 : 1
    let text = forms[index] ?? forms[0] ?? ''
    if (named !== undefined) {
      for (const [name, value] of Object.entries(named))
        text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }
}

const hr = noticeTranslator('hr')

it('renders the Croatian group notice for one, few, and other', () => {
  expect(groupRouteLeftNotice(hr, 1)).toBe('Grupa ima još 1 nedovršeno dodatno vozilo. Promjena nije primijenjena na njega.')
  expect(groupRouteLeftNotice(hr, 2)).toBe('Grupa ima još 2 nedovršena dodatna vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 3)).toBe('Grupa ima još 3 nedovršena dodatna vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 4)).toBe('Grupa ima još 4 nedovršena dodatna vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 22)).toBe('Grupa ima još 22 nedovršena dodatna vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 5)).toBe('Grupa ima još 5 nedovršenih dodatnih vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 11)).toBe('Grupa ima još 11 nedovršenih dodatnih vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 12)).toBe('Grupa ima još 12 nedovršenih dodatnih vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 14)).toBe('Grupa ima još 14 nedovršenih dodatnih vozila. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 21)).toBe('Grupa ima još 21 nedovršeno dodatno vozilo. Promjena nije primijenjena na njih.')
  expect(groupRouteLeftNotice(hr, 31)).toBe('Grupa ima još 31 nedovršeno dodatno vozilo. Promjena nije primijenjena na njih.')
})

it('keeps the English group notice on one vehicle and the rest', () => {
  const en = noticeTranslator('en')
  expect(groupRouteLeftNotice(en, 1)).toBe('The group still has 1 unfinished extra vehicle. This change was not applied to it.')
  expect(groupRouteLeftNotice(en, 2)).toBe('The group still has 2 unfinished extra vehicles. This change was not applied to them.')
  expect(groupRouteLeftNotice(en, 21)).toBe('The group still has 21 unfinished extra vehicles. This change was not applied to them.')
})
