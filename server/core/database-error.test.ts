import { expect, it } from 'vitest'
import { hideDatabaseError, postgresErrorCode } from './database-error'
import { captureLogs } from './testing'

const rideId = 'e1e1e1e1-2222-4222-8222-222222222222'
const leaked = `duplicate key ${rideId}`

function wrappedPgError(code: string, message: string): Error {
  const cause = Object.assign(new Error('pg'), { code, detail: message })
  return Object.assign(new Error(message), { cause })
}

class PassthroughError extends Error {
  constructor() {
    super('keep this')
    this.name = 'PassthroughError'
  }
}

it('reads the SQLSTATE from a wrapped cause and ignores a longer node code', () => {
  expect(postgresErrorCode(wrappedPgError('23505', leaked))).toBe('23505')
  expect(postgresErrorCode(Object.assign(new Error('no'), { code: 'ECONNRESET' }))).toBeUndefined()
  expect(postgresErrorCode(new Error(leaked))).toBeUndefined()
})

it('replaces a database failure, logs the SQLSTATE, and keeps bound values off the line', async () => {
  const logs = captureLogs('error')
  const error = await hideDatabaseError(
    async () => {
      throw wrappedPgError('23505', leaked)
    },
    'Ride assignment failed',
    { logger: logs.logger },
  ).catch(caught => caught)
  expect(error).toMatchObject({ message: 'Ride assignment failed' })
  expect(String(error)).not.toContain(rideId)
  const [line] = logs.lines()
  expect(line?.code).toBe('23505')
  expect(line?.msg).toBe('Ride assignment failed')
  expect(line).not.toHaveProperty('err')
  expect(line).not.toHaveProperty('detail')
  const text = JSON.stringify(line)
  expect(text).not.toContain(rideId)
  expect(text).not.toContain('duplicate')
})

it('rethrows a passthrough error without wrapping or logging', async () => {
  const logs = captureLogs('error')
  const original = new PassthroughError()
  await expect(hideDatabaseError(
    async () => {
      throw original
    },
    'Ride read failed',
    { passthrough: error => error instanceof PassthroughError, logger: logs.logger },
  )).rejects.toBe(original)
  expect(logs.lines()).toEqual([])
})
