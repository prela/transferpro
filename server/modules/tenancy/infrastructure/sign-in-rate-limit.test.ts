import { expect, it } from 'vitest'
import { signInRateLimit } from './auth'

it('limits email sign-in when the app is in production', () => {
  expect(signInRateLimit('production')).toEqual({
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': {
        window: 10,
        max: 3,
      },
    },
  })
  expect(signInRateLimit('development').enabled).toBe(false)
  expect(signInRateLimit(undefined).enabled).toBe(false)
})
