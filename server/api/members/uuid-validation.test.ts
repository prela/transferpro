import { describe, expect, it } from 'vitest'
import { z } from 'zod'

describe('userId route param validation', () => {
  it('accepts valid UUID', () => {
    const userId = '123e4567-e89b-12d3-a456-426614174000'
    const parsed = z.uuid().safeParse(userId)
    expect(parsed.success).toBe(true)
  })

  it('rejects invalid UUID format', () => {
    const userId = 'not-a-uuid'
    const parsed = z.uuid().safeParse(userId)
    expect(parsed.success).toBe(false)
  })

  it('rejects empty string', () => {
    const userId = ''
    const parsed = z.uuid().safeParse(userId)
    expect(parsed.success).toBe(false)
  })

  it('rejects null', () => {
    const parsed = z.uuid().safeParse(null)
    expect(parsed.success).toBe(false)
  })

  it('rejects undefined', () => {
    const parsed = z.uuid().safeParse(undefined)
    expect(parsed.success).toBe(false)
  })
})
