import { expect, it } from 'vitest'
import { endMoves, sameLanding, startMoves } from './window'

function at(hours: number, minutes: number): Date {
  return new Date(Date.UTC(2026, 9, 19, hours, minutes))
}

it('moves the start only when the pickup changes', () => {
  expect(startMoves({ pickupAt: at(10, 0), landingAt: null }, { pickupAt: at(10, 5), landingAt: null })).toBe(true)
  expect(startMoves({ pickupAt: at(10, 0), landingAt: at(10, 20) }, { pickupAt: at(10, 0), landingAt: null })).toBe(false)
})

it('moves the end when a cleared landing was after the pickup', () => {
  expect(endMoves({ pickupAt: at(10, 0), landingAt: at(10, 20) }, { pickupAt: at(10, 0), landingAt: null }, 60)).toBe(true)
})

it('keeps the end when a cleared landing was the pickup itself', () => {
  expect(endMoves({ pickupAt: at(10, 0), landingAt: at(10, 0) }, { pickupAt: at(10, 0), landingAt: null }, 60)).toBe(false)
})

it('compares landings by instant, and a missing landing only with another missing one', () => {
  expect(sameLanding({ pickupAt: at(10, 0), landingAt: at(10, 20) }, { pickupAt: at(10, 0), landingAt: new Date(at(10, 20).getTime()) })).toBe(true)
  expect(sameLanding({ pickupAt: at(10, 0), landingAt: at(10, 20) }, { pickupAt: at(10, 0), landingAt: at(10, 25) })).toBe(false)
  expect(sameLanding({ pickupAt: at(10, 0), landingAt: null }, { pickupAt: at(10, 0), landingAt: null })).toBe(true)
  expect(sameLanding({ pickupAt: at(10, 0), landingAt: at(10, 20) }, { pickupAt: at(10, 0), landingAt: null })).toBe(false)
})

it('keeps the end when nothing about the times changed', () => {
  expect(endMoves({ pickupAt: at(10, 0), landingAt: null }, { pickupAt: at(10, 0), landingAt: null }, 60)).toBe(false)
})
