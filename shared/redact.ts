/**
 * Personal-data and secret redaction shared by the logger (#33) and Sentry (#34).
 * Personal-data keys match the charter list; comparison ignores case and `_` / `-`.
 */

/** Shown in place of a redacted value. Tests treat this literal as proof. */
export const REDACTED = '[Redacted]'

/**
 * Personal-data keys, compared after lowercasing and stripping `_` and `-`.
 * Exact match only: a substring would also hide `username` or `hostname`.
 * `user_id` is absent on purpose. The charter allows that opaque id.
 */
const PERSONAL_KEYS = new Set([
  'name',
  'firstname',
  'lastname',
  'fullname',
  'guestname',
  'passengername',
  'displayname',
  'email',
  'emailaddress',
  'phone',
  'phonenumber',
  'mobile',
  'telephone',
  'flight',
  'flightnumber',
  'flightno',
  'address',
  'street',
  'streetaddress',
  'postalcode',
  'zipcode',
  'price',
  'prices',
  'fare',
  'note',
  'notes',
  // Postgres `detail` carries the row values that caused the error.
  'detail',
  'connectionstring',
])

/**
 * Secret keys match when the normalized name contains one of these.
 * `BETTER_AUTH_SECRET` and `AUTH_DATABASE_URL` are caught that way.
 */
const SECRET_PARTS = ['secret', 'token', 'password', 'cookie', 'authorization', 'apikey', 'databaseurl']

/**
 * An invitation id is a bearer secret (ADR-0013). These keys are redacted whole.
 * A URL in any other string is scrubbed below, including a log message.
 */
const INVITE_BEARER_KEYS = new Set(['invitationid', 'inviteurl'])

function scrubInviteBearer(value: string): string {
  // A fresh regex each call: a shared /g pattern would keep lastIndex.
  return value.replace(
    /(invitationId=|accept-invite[#/])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    '$1[Redacted]',
  )
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll('_', '').replaceAll('-', '')
}

function isRedactedKey(key: string, parentKey?: string): boolean {
  const normalized = normalizeKey(key)
  if (PERSONAL_KEYS.has(normalized) || INVITE_BEARER_KEYS.has(normalized))
    return true
  // `{ invitation: { id } }` is the bearer, not a user id.
  if (parentKey !== undefined && normalizeKey(parentKey) === 'invitation' && normalized === 'id')
    return true
  return SECRET_PARTS.some(part => normalized.includes(part))
}

/**
 * Walks the payload. Nested passenger names sit under `passenger.name`.
 * Error `name` is kept as `type`; `message` and `stack` are not scanned.
 */
export function redact(value: unknown, parentKey?: string): unknown {
  if (value instanceof Error) {
    const fields: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value))
      fields[key] = child
    delete fields.name
    fields.type = value.name
    fields.message = value.message
    fields.stack = value.stack
    return redact(fields, parentKey)
  }

  if (Array.isArray(value))
    return value.map(item => redact(item, parentKey))

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value))
      out[key] = isRedactedKey(key, parentKey) ? REDACTED : redact(child, key)
    return out
  }

  if (typeof value === 'string')
    return scrubInviteBearer(value)

  return value
}
