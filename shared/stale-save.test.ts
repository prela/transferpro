import { expect, it } from 'vitest'
import { staleSaveNotice } from './stale-save'

const at = '2026-10-19T08:30:00.000Z'

it('names the member and the time when both were recorded', () => {
  expect(staleSaveNotice('Dino Dispatcher', at)).toEqual({
    kind: 'named',
    name: 'Dino Dispatcher',
    at,
  })
})

it('names a member who left as a former member when the time was recorded', () => {
  expect(staleSaveNotice(null, at)).toEqual({ kind: 'former', at })
})

it('says someone changed it when no author was recorded', () => {
  expect(staleSaveNotice(null, null)).toEqual({ kind: 'unknown' })
  expect(staleSaveNotice('Dino Dispatcher', null)).toEqual({ kind: 'unknown' })
})
