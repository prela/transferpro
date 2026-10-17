/**
 * The reset token is a bearer secret. It stays in the hash so a request
 * log, which records the path and the query, never receives it.
 */
export function resetPasswordLink(baseURL: string, token: string): string {
  const url = new URL('/reset-password', baseURL)
  url.hash = token
  return url.href
}

/** The fragment of a reset link is the token. */
export function resetTokenFromLink(resetUrl: string): string {
  return new URL(resetUrl).hash.slice(1)
}
