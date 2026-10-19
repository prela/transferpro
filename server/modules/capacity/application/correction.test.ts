import { expect, it } from 'vitest'
import { correctionMovesWindow } from './correction'
import { fakeCapacityPorts } from './fake-ports'

function at(hours: number, minutes: number): Date {
  return new Date(Date.UTC(2026, 9, 19, hours, minutes))
}

it('judges a correction that moves the pickup without reading the Tenant minutes', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await expect(correctionMovesWindow(ports.minutes, { pickupAt: at(10, 0), landingAt: null }, { pickupAt: at(10, 30), landingAt: null })).resolves.toBe(true)
  expect(asked.minutes).toBe(0)
})

it('does not judge a correction that keeps the pickup and the landing', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await expect(correctionMovesWindow(ports.minutes, { pickupAt: at(10, 0), landingAt: at(10, 20) }, { pickupAt: at(10, 0), landingAt: at(10, 20) })).resolves.toBe(false)
  expect(asked.minutes).toBe(0)
})

it('judges a cleared landing that moves the end, with the Tenant duration', async () => {
  const { ports, asked } = fakeCapacityPorts()
  await expect(correctionMovesWindow(ports.minutes, { pickupAt: at(10, 0), landingAt: at(10, 20) }, { pickupAt: at(10, 0), landingAt: null })).resolves.toBe(true)
  expect(asked.minutes).toBe(1)
})

it('does not judge a cleared landing that was the pickup itself', async () => {
  const { ports } = fakeCapacityPorts()
  await expect(correctionMovesWindow(ports.minutes, { pickupAt: at(10, 0), landingAt: at(10, 0) }, { pickupAt: at(10, 0), landingAt: null })).resolves.toBe(false)
})
