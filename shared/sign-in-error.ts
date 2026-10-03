/**
 * One message for a bad sign-in. The status is not turned into "unknown email"
 * or "wrong password", so the screen does not reveal whether the email exists.
 * 429 is the rate limit, which also says nothing about the email.
 */
export function signInErrorKey(status: number): 'signIn.failed' | 'signIn.limited' {
  if (status === 429)
    return 'signIn.limited'
  return 'signIn.failed'
}
