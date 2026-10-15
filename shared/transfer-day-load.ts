import { isCalendarDate } from './date'

export interface LoadTicket {
  readonly counter: number
  readonly ticket: number
}

/**
 * The first read of the day and its catalogs. Always claims the next ticket.
 */
export function claimFullLoad(counter: number): LoadTicket {
  const ticket = counter + 1
  return { counter: ticket, ticket }
}

/**
 * A day read claims the next ticket only when the date can be fetched.
 * An empty or half-typed day returns null and leaves the counter, so it
 * cannot drop a full read that is still in flight (issue #252).
 */
export function claimDayLoad(counter: number, date: string): LoadTicket | null {
  if (!isCalendarDate(date))
    return null
  const ticket = counter + 1
  return { counter: ticket, ticket }
}
