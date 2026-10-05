/**
 * Platform directory. Callers import this file, not the infrastructure files.
 * Tenancy does not import this module. This file does not import tenancy internals.
 */
export { parseSuperadminCreateArgs, parseSuperadminRevokeArgs, parseTenantAccountArgs, PlatformArgsError } from './infrastructure/args'
export { closePlatformRuntime, listTenantAccounts, PlatformAccessError, readPlatformShell, readTenantAccount, renameTenantAccount } from './infrastructure/directory'
export { createSuperadmin, PlatformOperatorError, revokeSuperadmin, setTenantActive } from './infrastructure/operator'
export type { CreateSuperadminInput, SetTenantActiveInput } from './infrastructure/operator'
