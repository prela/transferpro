/**
 * Tenancy module. Callers import this file, not the infrastructure files.
 * The session helper is the way an HTTP request opens a tenant session.
 */
export { createTenant, TenantProvisionError } from './infrastructure/create-tenant'
export type { CreatedTenant, CreateTenantInput } from './infrastructure/create-tenant'
export { DemoSeedError, seedDemoTenant } from './infrastructure/demo-seed'
export type { SeedDemoTenantInput } from './infrastructure/demo-seed'
export { decideDemoSeed, demoSeedRefusalMessage } from './infrastructure/demo-seed-guard'
export type { DemoSeedDecisionInput, DemoSeedRefusal } from './infrastructure/demo-seed-guard'
export { setHoldingRideQuery } from './infrastructure/holding-ride'
export type { HoldingRideInput, HoldingRideQuery } from './infrastructure/holding-ride'
export { InvitationAccessError } from './infrastructure/invitation'
export { invitationEmail, mailerForApp, ResendTransportError } from './infrastructure/mailer'
export type { ArrivalMovedNotice, FlightWillNotArriveNotice, InvitationMail, Mailer, PasswordChangedMail, PasswordResetMail } from './infrastructure/mailer'
export { MemberAccessError } from './infrastructure/member-management'
export { acceptMemberInvitation, assertExpectedTenant, changeMemberRole, chooseActiveTenant, closeTenantRuntime, handleAuthRequest, inviteMember, listMembers, listPendingInvitations, listTenantChoices, officeWriteClaim, platformActorFromSession, previewMemberInvitation, readAccountIdentity, readAuditLog, readInvitationEmails, readInvitationForMail, readSessionShell, readSignInEmail, readTenantSettings, readUserLocale, removeTenantMember, repairInvitationRequest, revokePendingInvitation, switchActiveTenant, TenantAccessError, TenantChangedError, updateTenantSettings, updateUserLocale, withOfficeWrite, withTenantFromSession } from './infrastructure/session'
export type { OfficeWriteClaim } from './infrastructure/session'
export type { InvitationForMail, InvitationMailPort } from './infrastructure/session'
export { parseTenantCreateArgs, TenantCreateArgsError } from './infrastructure/tenant-create-args'
export type { TenantCreateArgs } from './infrastructure/tenant-create-args'
export { loadTenantDefaultLocale, loadTenantSettings, TenantSettingsMissingError } from './infrastructure/tenant-settings'
