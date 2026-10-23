import type { SQL } from 'drizzle-orm'
import type { TenantTransaction } from '../../../core/index'
import type { PlaceReferenceCheck } from '../maps-port'
import { PgDialect } from 'drizzle-orm/pg-core'
import { expect, it } from 'vitest'
import { PLACE_REF_MAX_LENGTH } from '../../../../shared'
import { captureLogs } from '../../../core/testing'
import { refreshPlaceReferences } from './place-refresh'

const askedAt = new Date('2026-10-23T03:00:00.000Z')
const dialect = new PgDialect()

interface Due {
  readonly id: string
  readonly kind: 'airport' | 'hotel' | 'address' | 'other'
  readonly placeRef: string
}

function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
}

function due(n: number, kind: Due['kind'], placeRef = `ChIJ${n}`): Due {
  return { id: id(n), kind, placeRef }
}

function fakeTransaction(rows: readonly Due[]) {
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    async execute(query: SQL) {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      if (compiled.sql.includes('from app.locations'))
        return { rows: rows.map(row => ({ id: row.id, kind: row.kind, placeRef: row.placeRef })) }
      return { rows: [], rowCount: 1 }
    },
  }
  return { transaction, queries }
}

function places(answer: (placeRef: string) => PlaceReferenceCheck) {
  const checked: string[] = []
  return {
    checked,
    port: {
      async checkPlaceRef(placeRef: string) {
        checked.push(placeRef)
        return answer(placeRef)
      },
    },
  }
}

function updates(queries: Array<{ sql: string, params: unknown[] }>) {
  return queries.filter(query => query.sql.includes('update app.locations'))
}

/** The SET list only. The WHERE also names place_provider and place_ref. */
function setClause(sql: string): string {
  const set = sql.indexOf(' set ')
  const where = sql.indexOf(' where ')
  return sql.slice(set, where === -1 ? undefined : where)
}

function isGone(query: { sql: string }) {
  return setClause(query.sql).includes('place_provider')
}

function isReplaced(query: { sql: string }) {
  return setClause(query.sql).includes('place_ref =')
}

async function refresh(
  rows: readonly Due[],
  answer: (placeRef: string) => PlaceReferenceCheck,
) {
  const { transaction, queries } = fakeTransaction(rows)
  const maps = places(answer)
  const logs = captureLogs()
  await refreshPlaceReferences({
    now: askedAt,
    transaction,
    places: maps.port,
    log: logs.logger,
  })
  return { queries, checked: maps.checked, lines: logs.lines() }
}

it('sets the check time when Google returns the same id', async () => {
  const row = due(1, 'hotel')
  const { queries, lines } = await refresh([row], () => ({ outcome: 'same' }))
  const written = updates(queries)
  expect(written).toHaveLength(1)
  expect(written[0]?.sql).toContain('place_ref_checked_at')
  expect(written[0]?.sql).not.toContain('place_ref =')
  expect(written[0]?.params).toContain(askedAt)
  expect(written[0]?.params).toContain(row.placeRef)
  expect(lines[0]).toMatchObject({ event: 'locations.place_refresh', same: 1, replaced: 0, gone: 0, unavailable: 0, invalid: 0, tripped: false })
})

it('stamps the time when a replacement id trims to the reference already stored', async () => {
  const row = due(1, 'hotel', 'ChIJsame')
  const { queries, lines } = await refresh([row], () => ({ outcome: 'replaced', placeRef: '  ChIJsame  ' }))
  const written = updates(queries)
  expect(written).toHaveLength(1)
  expect(isReplaced(written[0]!)).toBe(false)
  expect(written[0]?.params).toContain(askedAt)
  expect(written[0]?.params).toContain(row.placeRef)
  expect(lines[0]).toMatchObject({ same: 1, replaced: 0, invalid: 0 })
})

it('replaces the reference when Google returns a different id, and trims it', async () => {
  const row = due(1, 'airport')
  const next = 'ChIJnext'
  const { queries } = await refresh([row], () => ({ outcome: 'replaced', placeRef: `  ${next}  ` }))
  const written = updates(queries)
  expect(written).toHaveLength(1)
  expect(isReplaced(written[0]!)).toBe(true)
  expect(written[0]?.params).toContain(next)
  expect(written[0]?.params).toContain(row.placeRef)
  expect(written[0]?.params).toContain(askedAt)
  expect(written[0]?.params).not.toContain(`  ${next}  `)
})

it('clears the provider, the reference, and the time on NOT_FOUND, and keeps the address', async () => {
  const row = due(1, 'hotel', 'ChIJgone')
  const { queries } = await refresh([row], () => ({ outcome: 'gone' }))
  const written = updates(queries)
  expect(written).toHaveLength(1)
  expect(isGone(written[0]!)).toBe(true)
  expect(written[0]?.sql).not.toContain('address')
  expect(written[0]?.sql).toContain('place_provider = null')
  expect(written[0]?.sql).toContain('place_ref = null')
  expect(written[0]?.sql).toContain('place_ref_checked_at = null')
  expect(written[0]?.params).toContain(row.placeRef)
})

it('changes nothing when the place check throws, and the log keeps the message out', async () => {
  const row = due(1, 'hotel', 'ChIJthrows')
  const { transaction, queries } = fakeTransaction([row])
  const logs = captureLogs()
  await refreshPlaceReferences({
    now: askedAt,
    transaction,
    places: {
      async checkPlaceRef() {
        throw new Error(`place check failed ${row.placeRef}`)
      },
    },
    log: logs.logger,
  })
  expect(updates(queries)).toEqual([])
  expect(logs.lines()[0]).toMatchObject({ unavailable: 1, invalid: 0, same: 0, replaced: 0, gone: 0 })
  const text = JSON.stringify(logs.lines())
  expect(text).not.toContain(row.placeRef)
  expect(text).not.toContain('place check failed')
})

it('changes nothing on an unavailable answer, including an invalid id', async () => {
  const row = due(1, 'hotel')
  const { queries, lines } = await refresh([row], () => ({ outcome: 'unavailable' }))
  expect(updates(queries)).toEqual([])
  expect(lines[0]).toMatchObject({ unavailable: 1, invalid: 0, same: 0, replaced: 0, gone: 0 })
})

it('keeps the old reference and its time when a replacement id is blank or too long, and logs the outcome only', async () => {
  const kept = 'ChIJkept'
  const tooLong = `ChIJ${'x'.repeat(PLACE_REF_MAX_LENGTH)}`
  const blank = due(1, 'hotel', kept)
  const long = due(2, 'airport', 'ChIJlong')
  const { queries, lines } = await refresh([blank, long], (placeRef) => {
    if (placeRef === kept)
      return { outcome: 'replaced', placeRef: '   ' }
    return { outcome: 'replaced', placeRef: tooLong }
  })
  expect(updates(queries)).toEqual([])
  const text = JSON.stringify(lines)
  expect(lines[0]).toMatchObject({ invalid: 2, unavailable: 0, replaced: 0, same: 0, gone: 0 })
  expect(text).not.toContain(kept)
  expect(text).not.toContain(tooLong)
  expect(text).not.toContain('ChIJlong')
})

it('asks for at most 100 due google references, nulls and the oldest first, and skips archived rows', async () => {
  const first = due(1, 'hotel', 'ChIJfirst')
  const second = due(2, 'address', 'ChIJsecond')
  const { queries, checked } = await refresh([first, second], () => ({ outcome: 'same' }))
  const selected = queries[0]
  expect(selected?.sql).toContain('archived_at is null')
  expect(selected?.sql).toContain('place_provider')
  expect(selected?.sql).toContain('google')
  expect(selected?.sql).toContain('place_ref_checked_at is null')
  expect(selected?.sql).toContain('interval \'12 months\'')
  expect(selected?.sql).toContain('nulls first')
  expect(selected?.sql).toContain('limit 100')
  expect(selected?.params).toContain(askedAt)
  expect(checked).toEqual([first.placeRef, second.placeRef])
})

it('keeps an office pick made between the check and the write', async () => {
  const checked = 'ChIJchecked'
  const office = 'ChIJoffice'
  const google = 'ChIJgoogle'
  let stored = checked
  const queries: Array<{ sql: string, params: unknown[] }> = []
  const transaction: TenantTransaction = {
    async execute(query: SQL) {
      const compiled = dialect.sqlToQuery(query)
      queries.push(compiled)
      if (compiled.sql.includes('from app.locations'))
        return { rows: [{ id: id(1), kind: 'hotel', placeRef: stored }] }
      if (!compiled.sql.includes('update app.locations'))
        return { rows: [] }
      // A write that does not name the reference it read would overwrite the pick.
      const namesChecked = compiled.sql.includes('place_ref') && compiled.params.includes(checked)
      if (!namesChecked || stored !== checked)
        stored = namesChecked ? stored : google
      else
        stored = google
      return { rows: [], rowCount: stored === google && namesChecked ? 1 : 0 }
    },
  }
  await refreshPlaceReferences({
    now: askedAt,
    transaction,
    places: {
      async checkPlaceRef() {
        stored = office
        return { outcome: 'replaced', placeRef: google }
      },
    },
    log: captureLogs().logger,
  })
  expect(stored).toBe(office)
  expect(updates(queries)[0]?.params).toContain(checked)
})

it('trips when more than half of the non-address rows, and at least 10, are gone', async () => {
  // 10 gone and 7 unavailable hotels, plus one same and one replaced: 19
  // non-address rows, so 10 is more than half. The address is gone too.
  const hotels = Array.from({ length: 17 }, (_, index) => due(index + 1, 'hotel'))
  const address = due(40, 'address', 'ChIJaddress')
  const same = due(41, 'hotel', 'ChIJsame')
  const replaced = due(42, 'airport', 'ChIJreplaced')
  const rows = [...hotels, same, replaced, address]
  const goneIds = new Set(hotels.slice(0, 10).map(row => row.placeRef))
  const { queries, lines } = await refresh(rows, (placeRef) => {
    if (placeRef === same.placeRef)
      return { outcome: 'same' }
    if (placeRef === replaced.placeRef)
      return { outcome: 'replaced', placeRef: 'ChIJfresh' }
    if (placeRef === address.placeRef || goneIds.has(placeRef))
      return { outcome: 'gone' }
    return { outcome: 'unavailable' }
  })
  const written = updates(queries)
  expect(written.filter(isGone)).toEqual([])
  expect(written.filter(query => !isGone(query))).toHaveLength(2)
  expect(lines[0]).toMatchObject({
    same: 1,
    replaced: 1,
    gone: 11,
    unavailable: 7,
    invalid: 0,
    tripped: true,
    level: 40,
  })
  expect(JSON.stringify(lines)).not.toContain('ChIJaddress')
  expect(JSON.stringify(lines)).not.toContain('ChIJfresh')
})

it('does not trip below 10 gone, or when only address-kind rows are gone', async () => {
  const nine = Array.from({ length: 9 }, (_, index) => due(index + 1, 'hotel'))
  const below = await refresh(nine, () => ({ outcome: 'gone' }))
  expect(updates(below.queries).filter(isGone)).toHaveLength(9)
  expect(below.lines[0]).toMatchObject({ tripped: false, gone: 9, level: 30 })

  const addresses = Array.from({ length: 12 }, (_, index) => due(index + 1, 'address'))
  const hotels = [due(30, 'hotel', 'ChIJstay'), due(31, 'airport', 'ChIJalso')]
  const onlyAddresses = await refresh([...addresses, ...hotels], (placeRef) => {
    if (placeRef.startsWith('ChIJstay') || placeRef.startsWith('ChIJalso'))
      return { outcome: 'same' }
    return { outcome: 'gone' }
  })
  expect(updates(onlyAddresses.queries).filter(isGone)).toHaveLength(12)
  expect(onlyAddresses.lines[0]).toMatchObject({ tripped: false, gone: 12, same: 2 })
})

it('does not trip when exactly half of the non-address rows are gone', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => due(index + 1, 'other'))
  const goneIds = new Set(rows.slice(0, 10).map(row => row.placeRef))
  const { queries, lines } = await refresh(rows, placeRef => (
    goneIds.has(placeRef) ? { outcome: 'gone' } : { outcome: 'same' }
  ))
  expect(updates(queries).filter(isGone)).toHaveLength(10)
  expect(lines[0]).toMatchObject({ tripped: false, gone: 10, same: 10 })
})

it('writes no audit entry', async () => {
  const { queries } = await refresh([due(1, 'hotel')], () => ({ outcome: 'replaced', placeRef: 'ChIJnext' }))
  expect(queries.some(query => query.sql.includes('audit'))).toBe(false)
  expect(queries.some(query => query.sql.includes('append_entry'))).toBe(false)
})
