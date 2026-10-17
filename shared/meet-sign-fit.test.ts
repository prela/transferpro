import { expect, it } from 'vitest'
import { fittedMeetSign, MEET_SIGN_MIN_PX } from './meet-sign-fit'

it('keeps the largest meet-sign size that fits, including below 16px', () => {
  // A long tabla on a short landscape screen. 16px still overflows.
  expect(fittedMeetSign(48, size => size <= 10)).toEqual({ sizePx: 10, scrolls: false })
  expect(fittedMeetSign(48, () => true)).toEqual({ sizePx: 48, scrolls: false })
})

it('scrolls a meet sign that cannot fit even at the minimum size', () => {
  expect(MEET_SIGN_MIN_PX).toBe(8)
  expect(fittedMeetSign(48, () => false)).toEqual({ sizePx: 8, scrolls: true })
})
