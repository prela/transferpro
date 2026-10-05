/**
 * Credential rows for tests and Playwright.
 * ADR-0013: the operator script and POST /api/invitations/accept are the
 * only account-creation paths in the app. This file is the exception, and
 * server/api and app must not import it.
 */
export {
  insertCredentialMember,
  insertCredentialMemberConnecting,
  insertCredentialUser,
  insertCredentialUserConnecting,
  insertMembership,
} from './infrastructure/credential-member'
export type { CredentialDb, CredentialUserInput } from './infrastructure/credential-member'
