import type {
  CapacityMinutes,
  CapacityPorts,
  RangeOccupationQuery,
  ResourcePresence,
  RideOccupationQuery,
  UnavailabilityAuditFact,
  UnavailabilityPorts,
  UnavailabilityQuery,
} from './application/ports'
import type { OccupyingRide } from './domain/occupation'
import type { UnavailabilityWindow } from './domain/unavailability'
import { coversSpan } from './domain/unavailability'

/**
 * A fake occupation port for the application tests. It answers with the
 * Rides it was given and records every question, so a test can say what
 * capacity asked transfers without a database. Only tests import this.
 * `windows` is the answer to every unavailability question, as given.
 */
export function fakeCapacityPorts(
  answer: readonly OccupyingRide[] = [],
  minutes: CapacityMinutes = { transferDurationMinutes: 60, relocationGapMinutes: 15 },
  windows: readonly UnavailabilityWindow[] = [],
) {
  const asked = {
    ridesOf: [] as RideOccupationQuery[],
    ridesDuring: [] as RangeOccupationQuery[],
    windows: [] as UnavailabilityQuery[],
    minutes: 0,
  }
  const ports: CapacityPorts = {
    occupation: {
      ridesOf: async (query) => {
        asked.ridesOf.push(query)
        return answer
      },
      ridesDuring: async (query) => {
        asked.ridesDuring.push(query)
        return answer
      },
    },
    minutes: async () => {
      asked.minutes += 1
      return minutes
    },
    windows: async (query) => {
      asked.windows.push(query)
      return windows
    },
  }
  return { ports, asked }
}

/** The id the fake store gives the next inserted window. */
export const NEW_WINDOW_ID = 'f0f0f0f0-0000-4000-8000-000000000000'

/**
 * In-memory window ports. `calls` is the order in which the service used
 * them, so a test can pin the lock order; `audits` is every fact appended.
 * Every Driver, Vehicle, and Partner has the one `presence` given.
 */
export function fakeUnavailabilityPorts(options: {
  readonly windows?: readonly UnavailabilityWindow[]
  readonly removed?: readonly string[]
  readonly presence?: ResourcePresence
  readonly rides?: readonly OccupyingRide[]
} = {}) {
  const calls: string[] = []
  const audits: UnavailabilityAuditFact[] = []
  const rows = (options.windows ?? []).map(window => ({ ...window, removed: options.removed?.includes(window.id) ?? false }))
  const live = () => rows.filter(row => !row.removed).map(({ removed: _removed, ...window }) => window)
  const capacity = fakeCapacityPorts(options.rides)
  const logged = <T extends (...args: never[]) => Promise<unknown>>(name: string, run: T): T =>
    ((...args: Parameters<T>) => {
      calls.push(name)
      return run(...args)
    }) as T

  const ports: UnavailabilityPorts = {
    occupation: {
      ridesOf: logged('ridesOf', capacity.ports.occupation.ridesOf),
      ridesDuring: logged('ridesDuring', capacity.ports.occupation.ridesDuring),
    },
    minutes: logged('minutes', capacity.ports.minutes),
    windows: logged('windows', async (query: UnavailabilityQuery) => live().filter(window => coversSpan(window, query.from, query.to))),
    lock: logged('lock', async () => {}),
    audit: logged('audit', async (fact: UnavailabilityAuditFact) => {
      audits.push(fact)
    }),
    presence: async (resource) => {
      calls.push(`presence:${resource.kind}`)
      return options.presence ?? 'active'
    },
    store: {
      insert: logged('insert', async (record) => {
        const window = { id: NEW_WINDOW_ID, ...record }
        rows.push({ ...window, removed: false })
        return window
      }),
      lockLive: logged('lockLive', async (windowId: string) => live().find(window => window.id === windowId) ?? null),
      update: logged('update', async (windowId: string, times) => {
        const row = rows.find(window => window.id === windowId)
        if (!row)
          throw new Error('No such window in the fake.')
        Object.assign(row, times)
        const { removed: _removed, ...window } = row
        return window
      }),
      markRemoved: logged('markRemoved', async (windowId: string) => {
        const row = rows.find(window => window.id === windowId)
        if (row)
          row.removed = true
      }),
      liveOf: logged('liveOf', async resource => live().filter((window) => {
        const id = resource.kind === 'driver'
          ? window.driverId
          : resource.kind === 'vehicle'
            ? window.vehicleId
            : window.partnerId
        return id === resource.id
      })),
      liveDuring: logged('liveDuring', async (from: Date, to: Date) => live().filter(window => coversSpan(window, from, to))),
    },
  }
  return { ports, calls, audits, asked: capacity.asked }
}
