import type { DisplayLocale, TenantRole } from '../../../../shared'
import type { AuthHandle } from './auth'
import process from 'node:process'
import { z } from 'zod'
import { invitationAcceptBodySchema, invitationPreviewBodySchema, inviteInputSchema, inviteLink, tenantRoleSchema } from '../../../../shared'
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
const allowAcceptAttempt = createAttemptLimiter(acceptAttemptLimit(process.env.NODE_ENV))

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
): Promise<{ state: 'set-password' | 'sign-in' | 'invalid' }> {
  const invitationId = parsePreview(raw)
  const record = await handle.invitationById(invitationId)
  if (record === null || !usable(record))
    return { state: 'invalid' }
  const existing = await handle.userIdByEmail(record.email)
  return { state: existing === null ? 'set-password' : 'sign-in' }
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
    return acceptWithCookie(handle, body.invitationId, headers.get('cookie') ?? '')
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
    const cookie = cookieHeader(signedIn.headers)
    if (cookie === '')
      throw new InvitationAccessError(500)
    return await acceptWithCookie(handle, body.invitationId, cookie, userId)
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
  userIdToRemove?: string,
): Promise<AcceptCookies> {
  try {
    // Server API, not auth.handler. The handler's default limiter would key
    // every accept on one shared address.
    const accepted = await handle.auth.api.acceptInvitation({
      body: { invitationId },
      headers: { cookie },
      returnHeaders: true,
    })
    const cookies = accepted.headers.getSetCookie()
    if (cookies.length > 0)
      return { cookies }
    // Accept updates the session row in place. The sign-in cookie still names it.
    const token = cookie.split(';').map(part => part.trim()).find(part => part.includes('session_token'))
    return { cookies: token === undefined ? [] : [token] }
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
 * and sign-up. The numbers are not repeated here.
 */
async function assertPassword(handle: AuthHandle, password: string): Promise<void> {
  const ctx = await handle.auth.$context
  const { minPasswordLength, maxPasswordLength } = ctx.password.config
  if (password.length < minPasswordLength || password.length > maxPasswordLength)
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

function invitationFailure(error: unknown): InvitationAccessError {
  if (error instanceof InvitationAccessError)
    return error
  const status = statusCodeOf(error)
  if (status === 403)
    return new InvitationAccessError(403)
  if (status === 401)
    return new InvitationAccessError(401)
  return new InvitationAccessError(400)
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
