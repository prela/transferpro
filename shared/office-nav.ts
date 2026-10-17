/**
 * The office frame's navigation (ADR-0038).
 * Podizvođači, Cjenik, and Računi stay out until those modules exist.
 * The urgent count on Home is the number of Rides in Pozornost (ADR-0039).
 * Null until that read arrives. Other items never carry it.
 */

export type OfficeNavRole = 'admin' | 'dispatcher'

export interface OfficeNavLabels {
  readonly operations: string
  readonly catalogs: string
  readonly management: string
  readonly home: string
  readonly transfers: string
  readonly roster: string
  readonly clients: string
  readonly locations: string
  readonly drivers: string
  readonly vehicles: string
  readonly audit: string
  readonly companySettings: string
}

export interface OfficeNavLink {
  readonly id: 'home' | 'transfers' | 'roster' | 'clients' | 'locations' | 'drivers' | 'vehicles' | 'audit' | 'companySettings'
  readonly label: string
  readonly to: string
  readonly exact: boolean
  /** Only Home carries this. Null until the office home read arrives. */
  readonly urgentCount: number | null
}

export interface OfficeNavGroup {
  readonly id: 'operations' | 'catalogs' | 'management'
  readonly label: string
  readonly links: readonly OfficeNavLink[]
}

export function officeNav(
  role: OfficeNavRole,
  labels: OfficeNavLabels,
  urgentCount: number | null = null,
): readonly OfficeNavGroup[] {
  const operations: OfficeNavGroup = {
    id: 'operations',
    label: labels.operations,
    links: [
      link('home', labels.home, '/', true, urgentCount),
      link('transfers', labels.transfers, '/transfers', false),
      link('roster', labels.roster, '/roster', false),
    ],
  }
  const catalogs: OfficeNavGroup = {
    id: 'catalogs',
    label: labels.catalogs,
    links: [
      link('clients', labels.clients, '/clients', false),
      link('locations', labels.locations, '/locations', false),
      link('drivers', labels.drivers, '/drivers', false),
      link('vehicles', labels.vehicles, '/vehicles', false),
    ],
  }
  if (role === 'dispatcher')
    return [operations, catalogs]
  return [
    operations,
    catalogs,
    {
      id: 'management',
      label: labels.management,
      links: [
        link('audit', labels.audit, '/audit', true),
        link('companySettings', labels.companySettings, '/settings', false),
      ],
    },
  ]
}

/** Phone bottom bar. The rest of the role's items open from Više. */
export function officePhoneBar(groups: readonly OfficeNavGroup[]): readonly OfficeNavLink[] {
  const operations = groups.find(group => group.id === 'operations')
  return operations?.links ?? []
}

function link(
  id: OfficeNavLink['id'],
  label: string,
  to: string,
  exact: boolean,
  urgentCount: number | null = null,
): OfficeNavLink {
  return {
    id,
    label,
    to,
    exact,
    urgentCount,
  }
}

/** Up to two letters from the account name. The menu trigger shows these. */
export function accountInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(part => part.length > 0).slice(0, 2)
  const letters = parts.map(part => Array.from(part)[0] ?? '').join('')
  return letters.toLocaleUpperCase('hr')
}
