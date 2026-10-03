import { expect, it } from 'vitest'
import { acceptAttemptLimit, createAttemptLimiter, signInRateLimit } from './auth'

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

it('limits invitation accept with the email sign-in rule', () => {
  const signIn = signInRateLimit('production')
  const email = signIn.customRules['/sign-in/email']
  expect(acceptAttemptLimit('production')).toEqual({
    enabled: signIn.enabled,
    window: email.window,
    max: email.max,
  })
  expect(acceptAttemptLimit('development').enabled).toBe(false)

  const rule = acceptAttemptLimit('production')
  const allow = createAttemptLimiter(rule)
  const now = 1_700_000_000_000
  for (let attempt = 0; attempt < rule.max; attempt++)
    expect(allow('203.0.113.8', now)).toBe(true)
  expect(allow('203.0.113.8', now)).toBe(false)
  expect(allow('203.0.113.9', now)).toBe(true)
  expect(allow('203.0.113.8', now + rule.window * 1000)).toBe(true)
})
