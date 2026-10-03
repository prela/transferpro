/**
 * Tenancy module. Callers import this file, not the infrastructure files.
 * The session helper is the way an HTTP request opens a tenant session.
 */
export { createTenant, TenantProvisionError } from './infrastructure/create-tenant'
export type { CreatedTenant, CreateTenantInput } from './infrastructure/create-tenant'
export { closeTenantRuntime, handleAuthRequest, TenantAccessError, withTenantFromSession } from './infrastructure/session'
export { parseTenantCreateArgs, TenantCreateArgsError } from './infrastructure/tenant-create-args'
export type { TenantCreateArgs } from './infrastructure/tenant-create-args'
