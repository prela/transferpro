import type { RideTimes } from '../domain/window'
import type { CapacityMinutesReader } from './ports'
import { endMoves, sameLanding, startMoves } from '../domain/window'

/**
 * Whether a Transfer correction moves the occupied window, comparing the
 * stored times with the times after the save (ADR-0029). Only a correction
 * that moves it is judged, and only that one is a capacity write.
 * A pickup change moves the start. A cleared landing can move the end.
 * The Tenant duration is read only when the end alone decides.
 */
export async function correctionMovesWindow(
  minutes: CapacityMinutesReader,
  before: RideTimes,
  after: RideTimes,
): Promise<boolean> {
  if (startMoves(before, after))
    return true
  if (sameLanding(before, after))
    return false
  const { transferDurationMinutes } = await minutes()
  return endMoves(before, after, transferDurationMinutes)
}
