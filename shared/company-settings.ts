import type { TenantRole } from './tenant-role'

/** Operativa is the address with no query. Članovi is `?tab=members`. */
export type CompanySettingsTab = 'operations' | 'members'

/** Drop a trailing slash so `/settings/` and `/settings` are the same address. */
export function barePath(path: string): string {
  return path.replace(/\/$/, '') || '/'
}

/** Same address the page router matches, including a different letter case. */
export function foldedPath(path: string): string {
  return barePath(path).toLowerCase()
}

/**
 * `/settings`, and the old Tenant and Members addresses.
 * Profile is not one of these: it redirects for every role, including Admin.
 * The page router matches these addresses without regard to case, and from
 * Nuxt 4.6.2 the server route rules do too, so `/Settings` is this route.
 */
export function isCompanySettingsPath(path: string): boolean {
  const bare = foldedPath(path)
  return bare === '/settings' || bare === '/settings/tenant' || bare === '/settings/members'
}

/**
 * Where an old settings address goes.
 * Null means this role may stay. A dispatcher or a driver is sent to Profile
 * from the route, which is the refusal, not a hidden link.
 * An admin bookmark to `/settings/tenant` or `/settings/members` lands on the tab.
 */
export function companySettingsRedirect(path: string, role: TenantRole): string | null {
  const bare = foldedPath(path)
  if (bare === '/settings/profile')
    return '/profile'
  if (!isCompanySettingsPath(bare))
    return null
  if (role !== 'admin')
    return '/profile'
  if (bare === '/settings/tenant')
    return '/settings'
  if (bare === '/settings/members')
    return '/settings?tab=members'
  return null
}

/** Anything other than the members query is Operativa, including a repeated query. */
export function companySettingsTab(tab: unknown): CompanySettingsTab {
  const value = Array.isArray(tab) ? tab[0] : tab
  return value === 'members' ? 'members' : 'operations'
}
