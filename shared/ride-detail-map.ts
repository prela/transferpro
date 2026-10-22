/**
 * Which maps the Ride detail may show (ADR-0052).
 * The end is omitted when it is the same Location as the start, so the
 * office does not open the same map twice. A null URL is a Location with
 * no map: typed by hand, archived, or Embed switched off.
 */
export function rideDetailEmbedUrls(input: {
  readonly startLocationId: string
  readonly endLocationId: string
  readonly startEmbedUrl: string | null
  readonly endEmbedUrl: string | null
}): { start: string | null, end: string | null } {
  const sameLocation = input.startLocationId === input.endLocationId
  return {
    start: input.startEmbedUrl,
    end: sameLocation ? null : input.endEmbedUrl,
  }
}

/** Whether each map is open. Both start closed. */
export interface RideDetailMapState {
  readonly start: boolean
  readonly end: boolean
}

/**
 * The next open maps after a refresh or a press (ADR-0052).
 * Another Ride closes both, and a press in that same change does not
 * reopen one. A URL that is gone closes that map. A URL that changed
 * leaves the map open so the frame reloads in place. On a phone, opening
 * one closes the other. A desktop leaves the other as it was.
 */
export function rideDetailMapOpen(
  current: RideDetailMapState,
  change: {
    readonly rideChanged: boolean
    readonly startUrl: string | null
    readonly endUrl: string | null
    readonly phone: boolean
    readonly press: { readonly slot: 'start' | 'end', readonly open: boolean } | null
  },
): RideDetailMapState {
  if (change.rideChanged)
    return { start: false, end: false }

  let start = current.start && change.startUrl !== null
  let end = current.end && change.endUrl !== null
  const press = change.press
  if (press?.slot === 'start' && change.startUrl !== null) {
    start = press.open
    if (change.phone && start)
      end = false
  }
  if (press?.slot === 'end' && change.endUrl !== null) {
    end = press.open
    if (change.phone && end)
      start = false
  }
  return { start, end }
}
