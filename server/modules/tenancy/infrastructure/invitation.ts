import type { DisplayLocale, TenantRole } from '../../../../shared'
import type { AuthHandle } from './auth'
import { z } from 'zod'
import { invitationAcceptBodySchema, invitationPreviewBodySchema, inviteInputSchema, inviteLink, passwordLengthRule, tenantRoleSchema } from '../../../../shared'
import { nodeEnv } from '../../../core/index'
import { acceptAttemptLimit, createAttemptLimiter } from './auth'
import { inviteSendState } from './invite-send'

/**
 * Fixed phrases. The id, the email, and the password never go in the message:
 * a thrown error can be logged, and the message is not a redacted field
 * except for the invite-URL pattern.
 */
const MESSAGE: Record<InvitationStatus, string> = {
  400: 'Invitation is not valid.',
  401: 'Unauthorized',
  403: 'Forbidden',
  409: 'Account already exists.',
  422: 'Password is not valid.',
  429: 'Too many attempts.',
  500: 'Invitation could not be accepted.',
}

type InvitationStatus = 400 | 401 | 403 | 409 | 422 | 429 | 500

export class InvitationAccessError extends Error {
  readonly statusCode: InvitationStatus

  constructor(statusCode: InvitationStatus) {
    super(MESSAGE[statusCode])
    this.name = 'InvitationAccessError'
    this.statusCode = statusCode
  }
}

export interface SendInvitationInput {
  readonly email: string
  readonly role: TenantRole
  readonly organizationId: string
  readonly locale: DisplayLocale
}

export interface AcceptCookies {
  readonly cookies: readonly string[]
}

interface AcceptAttempt {
  readonly key: string
}

/**
 * Production uses the sign-in limit, keyed by the client address the route
 * passes. Tests run with NODE_ENV=test, which disables it. This is the only
 * limit on accept: the new-account sign-in does not go through the HTTP handler.
 */
const allowAcceptAttempt = createAttemptLimiter(acceptAttemptLimit(nodeEnv()))

export function parseInviteInput(raw: unknown): { email: string, role: TenantRole } {
  const parsed = inviteInputSchema.safeParse(raw)
  if (!parsed.success)
    throw new InvitationAccessError(400)
  return {
    email: parsed.data.email.toLowerCase(),
    role: parsed.data.role,
  }
}

export async function sendInvitation(
  handle: AuthHandle,
  headers: Headers,
  input: SendInvitationInput,
): Promise<{ inviteUrl: string, emailSent: boolean }> {
  const state = { locale: input.locale, emailSent: false }
  const invitationId = await inviteSendState.run(state, async () => {
    try {
      const created: unknown = await handle.auth.api.createInvitation({
        body: {
          email: input.email,
          role: input.role,
          organizationId: input.organizationId,
        },
        headers,
      })
      return readInvitationId(created)
    }
    catch (error) {
      throw invitationFailure(error)
    }
  })
  return {
    inviteUrl: inviteLink(handle.baseURL, invitationId),
    emailSent: state.emailSent,
  }
}

export async function previewInvitation(
  handle: AuthHandle,
  raw: unknown,
  headers?: Headers,
): Promise<{ state: 'set-password', minPasswordLength: number, maxPasswordLength: number } | { state: 'sign-in' } | { state: 'invalid' } | { state: 'wrong-account', account: string }> {
  const invitationId = parsePreview(raw)
  const record = await handle.invitationById(invitationId)
  if (record === null || !usable(record))
    return { state: 'invalid' }
  // A session for a different account cannot accept. The screen names that
  // account and offers sign-out, instead of a bare refusal after submit.
  if (headers) {
    const session = await handle.auth.api.getSession({ headers })
    const account = session?.user.email
    if (account !== undefined && account.toLowerCase() !== record.email.toLowerCase())
      return { state: 'wrong-account', account }
  }
  const existing = await handle.userIdByEmail(record.email)
  if (existing !== null)
    return { state: 'sign-in' }
  return { state: 'set-password', ...await passwordLimits(handle) }
}

/**
 * New account: name and password, email copied from the invitation.
 * Existing account: a session whose email matches, then Better Auth accept.
 * The HTTP route passes the sign-in rate limit. This function applies it.
 */
export async function acceptInvitation(
  handle: AuthHandle,
  raw: unknown,
  headers: Headers,
  attempt?: AcceptAttempt,
): Promise<AcceptCookies> {
  const key = attempt?.key ?? 'local'
  if (!allowAcceptAttempt(key, Date.now()))
    throw new InvitationAccessError(429)

  const body = parseAccept(raw)
  const record = await handle.invitationById(body.invitationId)
  if (record === null || !usable(record))
    throw new InvitationAccessError(400)

  const session = await handle.auth.api.getSession({ headers })
  if (session) {
    if (session.user.email.toLowerCase() !== record.email.toLowerCase())
      throw new InvitationAccessError(403)
    // The browser already holds this session. Echoing the request Cookie
    // would store a second copy with no Path.
    await acceptMembership(handle, body.invitationId, headers.get('cookie') ?? '')
    return { cookies: [] }
  }

  const existing = await handle.userIdByEmail(record.email)
  if (existing !== null)
    throw new InvitationAccessError(409)

  if (body.name === undefined || body.password === undefined)
    throw new InvitationAccessError(400)

  await assertPassword(handle, body.password)
  const userId = await insertOrConflict(handle, record.email, body.name, body.password)
  try {
    // Server API, not auth.handler. The handler's sign-in rule would key every
    // new account on one shared address and turn the fourth accept into a 500.
    const signedIn = await handle.auth.api.signInEmail({
      body: {
        email: record.email,
        password: body.password,
      },
      returnHeaders: true,
    })
    const signInCookies = signedIn.headers.getSetCookie()
    const cookie = cookieHeader(signedIn.headers)
    if (cookie === '')
      throw new InvitationAccessError(500)
    return await acceptWithCookie(handle, body.invitationId, cookie, signInCookies, userId)
  }
  catch (error) {
    if (userId !== null)
      await handle.deleteUser(userId).catch(() => {})
    if (error instanceof InvitationAccessError)
      throw error
    throw new InvitationAccessError(500)
  }
}

async function acceptWithCookie(
  handle: AuthHandle,
  invitationId: string,
  cookie: string,
  signInCookies: readonly string[],
  userIdToRemove?: string,
): Promise<AcceptCookies> {
  const issued = await acceptMembership(handle, invitationId, cookie, userIdToRemove)
  // Accept updates the session row in place and often sets nothing.
  // The sign-in Set-Cookie already names that row, attributes included.
  if (issued.length > 0)
    return { cookies: issued }
  return { cookies: [...signInCookies] }
}

/**
 * Server API, not auth.handler. The handler's default limiter would key
 * every accept on one shared address.
 */
async function acceptMembership(
  handle: AuthHandle,
  invitationId: string,
  cookie: string,
  userIdToRemove?: string,
): Promise<readonly string[]> {
  try {
    const accepted = await handle.auth.api.acceptInvitation({
      body: { invitationId },
      headers: { cookie },
      returnHeaders: true,
    })
    return accepted.headers.getSetCookie()
  }
  catch (error) {
    if (userIdToRemove !== undefined)
      await handle.deleteUser(userIdToRemove).catch(() => {})
    throw new InvitationAccessError(statusCodeOf(error) === 403 ? 403 : 400)
  }
}

async function insertOrConflict(handle: AuthHandle, email: string, name: string, password: string): Promise<string> {
  try {
    return await handle.insertInvitedUser({ email, name, password })
  }
  catch (error) {
    if (isUniqueViolation(error))
      throw new InvitationAccessError(409)
    throw new InvitationAccessError(500)
  }
}

/**
 * Min and max come from the auth context Better Auth built for sign-in
 * and sign-up. The numbers are not repeated here. The screen uses the
 * same check, so a failed rule is named from this config.
 */
async function passwordLimits(handle: AuthHandle): Promise<{ minPasswordLength: number, maxPasswordLength: number }> {
  const ctx = await handle.auth.$context
  const { minPasswordLength, maxPasswordLength } = ctx.password.config
  return { minPasswordLength, maxPasswordLength }
}

async function assertPassword(handle: AuthHandle, password: string): Promise<void> {
  if (passwordLengthRule(password, await passwordLimits(handle)) !== null)
    throw new InvitationAccessError(422)
}

function usable(record: { status: string, expiresAt: Date, role: string | null }): boolean {
  return record.status === 'pending'
    && record.expiresAt.getTime() > Date.now()
    && tenantRoleSchema.safeParse(record.role).success
}

function parsePreview(raw: unknown): string {
  const parsed = invitationPreviewBodySchema.safeParse(raw)
  if (!parsed.success)
    throw new InvitationAccessError(400)
  return parsed.data.invitationId
}

function parseAccept(raw: unknown): { invitationId: string, name?: string, password?: string } {
  const parsed = invitationAcceptBodySchema.safeParse(raw)
  if (!parsed.success)
    throw new InvitationAccessError(400)
  return parsed.data
}

function readInvitationId(created: unknown): string {
  const parsed = z.object({ id: z.uuid() }).safeParse(created)
  if (!parsed.success)
    throw new InvitationAccessError(500)
  return parsed.data.id
}

const ALREADY_IN_ORGANIZATION = new Set([
  'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
  'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION',
])

function invitationFailure(error: unknown): InvitationAccessError {
  if (error instanceof InvitationAccessError)
    return error
  // Better Auth reports both as 400. The screen treats 409 as "already in".
  const code = betterAuthCode(error)
  if (code !== undefined && ALREADY_IN_ORGANIZATION.has(code))
    return new InvitationAccessError(409)
  const status = statusCodeOf(error)
  if (status === 403)
    return new InvitationAccessError(403)
  if (status === 401)
    return new InvitationAccessError(401)
  return new InvitationAccessError(400)
}

function betterAuthCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('body' in error))
    return undefined
  const body = error.body
  if (typeof body !== 'object' || body === null || !('code' in body))
    return undefined
  return typeof body.code === 'string' ? body.code : undefined
}

function statusCodeOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const code = error.statusCode
    if (typeof code === 'number')
      return code
  }
  return undefined
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function cookieHeader(headers: Headers): string {
  return headers.getSetCookie()
    .map(part => part.split(';')[0] ?? '')
    .filter(part => part !== '')
    .join('; ')
}

const sessionCookieNameSchema = z.object({
  authCookies: z.object({
    sessionToken: z.object({
      name: z.string().min(1),
    }),
  }),
})

/**
 * A Set-Cookie with no Path is stored on the directory of the request.
 * POST /api/invitations/accept therefore left a session cookie on
 * /api/invitations. Max-Age 0 on that path drops the copy. Path=/ would
 * drop the real session.
 */
const SHADOW_COOKIE_PATH = '/api/invitations'

export async function repairInvitationCookies(handle: AuthHandle, headers: Headers): Promise<{
  headers: Headers
  clearShadow: string
}> {
  const parsed = sessionCookieNameSchema.safeParse(await handle.auth.$context)
  if (!parsed.success)
    throw new InvitationAccessError(500)
  const name = parsed.data.authCookies.sessionToken.name
  return {
    headers: keepLastSessionCookie(headers, name),
    clearShadow: invitationShadowClear(name),
  }
}

/**
 * Browsers ignore a `__Secure-` name that is not marked Secure, so the
 * production clear would never land. Path stays the shadow directory.
 */
export function invitationShadowClear(name: string): string {
  const secure = name.startsWith('__Secure-') ? '; Secure' : ''
  return `${name}=; Path=${SHADOW_COOKIE_PATH}; Max-Age=0${secure}`
}

/**
 * Better Auth keeps the first value when the same cookie is sent twice.
 * The browser sends the longer path first, so the shadow hides the Path=/
 * session. One cookie is left as it arrived.
 */
function keepLastSessionCookie(headers: Headers, name: string): Headers {
  const next = new Headers(headers)
  const cookie = next.get('cookie')
  if (cookie === null)
    return next
  const pairs = cookie.split(';').map(part => part.trim()).filter(part => part !== '')
  let last: string | undefined
  let copies = 0
  const kept: string[] = []
  for (const pair of pairs) {
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    if (key === name) {
      last = pair
      copies += 1
      continue
    }
    kept.push(pair)
  }
  if (copies < 2 || last === undefined)
    return next
  next.set('cookie', [...kept, last].join('; '))
  return next
}
