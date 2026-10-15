import type { PaymentKind, PrototypeRide, RideState, UrgentKind, WarningKind } from './day'

export function stateBadge(state: RideState): { color: 'warning' | 'primary' | 'info' | 'success' | 'error' | 'neutral', variant: 'subtle' | 'outline' } {
  if (state === 'assigned')
    return { color: 'warning', variant: 'outline' }
  if (state === 'accepted')
    return { color: 'primary', variant: 'subtle' }
  if (state === 'in-progress')
    return { color: 'info', variant: 'subtle' }
  if (state === 'done')
    return { color: 'success', variant: 'subtle' }
  if (state === 'no-show')
    return { color: 'error', variant: 'outline' }
  if (state === 'cancelled')
    return { color: 'neutral', variant: 'subtle' }
  return { color: 'warning', variant: 'subtle' }
}

export function rowAction(state: RideState): 'assign' | 'confirmPhone' | 'done' | null {
  if (state === 'unassigned')
    return 'assign'
  if (state === 'assigned')
    return 'confirmPhone'
  if (state === 'in-progress')
    return 'done'
  return null
}

export function money(cents: number): string {
  return new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

export function urgentLabel(copy: { groups: Record<UrgentKind, string> }, ride: PrototypeRide): string | null {
  if (!ride.urgent)
    return null
  if (ride.urgent === 'decline' && ride.declinedBy)
    return `${copy.groups.decline}: ${ride.declinedBy}`
  return copy.groups[ride.urgent]
}

export function warningLabels(copy: { warnings: Record<WarningKind, string> }, ride: PrototypeRide): string[] {
  return ride.warnings.map(warning => copy.warnings[warning])
}

export function paymentLabel(copy: { payments: Record<PaymentKind, string> }, ride: PrototypeRide): string {
  return copy.payments[ride.payment]
}
