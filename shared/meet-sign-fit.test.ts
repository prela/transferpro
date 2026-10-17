import { expect, it } from 'vitest'
import { fittedMeetSign, MEET_SIGN_MIN_PX } from './meet-sign-fit'

it('keeps the largest meet-sign size that fits, and does not go below 28px', () => {
  expect(fittedMeetSign(48, size => size <= 32)).toEqual({ sizePx: 32, scrolls: false })
  expect(fittedMeetSign(48, () => true)).toEqual({ sizePx: 48, scrolls: false })
  // 16px would fit the frame. The floor is 28, so the sign stays 28 and scrolls.
  expect(fittedMeetSign(48, size => size <= 16)).toEqual({ sizePx: 28, scrolls: true })
})

it('scrolls a meet sign that cannot fit even at 28px', () => {
  expect(MEET_SIGN_MIN_PX).toBe(28)
  expect(fittedMeetSign(48, () => false)).toEqual({ sizePx: 28, scrolls: true })
})
