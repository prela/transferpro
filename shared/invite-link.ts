/**
 * The invitation id is a bearer secret. It stays in the hash so a request
 * log, which records the path and the query, never receives it.
 */
export function inviteLink(baseURL: string, invitationId: string): string {
  const url = new URL('/accept-invite', baseURL)
  url.hash = invitationId
  return url.href
}
