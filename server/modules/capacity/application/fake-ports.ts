import type { OccupyingRide } from '../domain/occupation'
import type { CapacityMinutes, CapacityPorts, RangeOccupationQuery, RideOccupationQuery } from './ports'

/**
 * A fake occupation port for the application tests. It answers with the
 * Rides it was given and records every question, so a test can say what
 * capacity asked transfers without a database. Only tests import this.
 */
export function fakeCapacityPorts(
  answer: readonly OccupyingRide[] = [],
  minutes: CapacityMinutes = { transferDurationMinutes: 60, relocationGapMinutes: 15 },
) {
  const asked = {
    ridesOf: [] as RideOccupationQuery[],
    ridesDuring: [] as RangeOccupationQuery[],
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
  }
  return { ports, asked }
}
