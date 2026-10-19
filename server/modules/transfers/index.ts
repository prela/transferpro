/**
 * Transfers module. Callers import this file, not the infrastructure files.
 * A Transfer is the booking. Creating one creates exactly one unassigned Ride.
 * Assignment gives that Ride a Driver and a Vehicle together.
 * The Driver accepts that Ride when the copied flag is on.
 * The office records that same acceptance after confirming by phone.
 * The Driver or the office marks the Ride done: from `assigned` when the
 * copied flag is off, and only from `accepted` when the flag is on.
 * A No-show uses that same pair. The Driver may mark it only after the
 * Tenant's wait, read at the attempt. The office may mark it earlier.
 * No fee is stored. No mail is sent.
 * The Driver declines from `assigned` only. The Ride returns to unassigned
 * and a decline alert names that Driver. No mail.
 * The office may cancel from `unassigned`, `assigned`, or `accepted`.
 * That cancel mails the current Driver a work order with status cancelled
 * and no price, after the Ride is saved. A Ride with no Driver sends nothing.
 * The office or the assigned Driver can record or clear a landing time
 * while the Ride is unfinished. The Ride state stays. No mail.
 * The office can correct the Transfer while the Ride is unfinished.
 * A correction that moves the occupied window of an assigned or accepted
 * Ride is refused until the office confirms a true overlap.
 * A change of pickup, start, end, or flight number returns an accepted
 * Ride to assigned and keeps the Driver, the Vehicle, and the copied flag.
 * A real change mails the current Driver one work order with status
 * changed, after the booking is saved. A price change mails only while
 * payment is cash. A Ride with no Driver sends nothing.
 * The office can change only the Vehicle, clear the Ride, or reassign it.
 * Each of those mails a work order after the Ride is saved.
 * Clients, Locations, Drivers, Vehicles, and the roster are reached through
 * their index files, by id. Those modules do not import this one (ADR-0018).
 * Whether a Driver or a Vehicle is taken is the capacity module's decision
 * (ADR-0034). Transfers implements its occupation port, takes its Tenant
 * lock, and re-exports its `RideOverlapError` and `RideUnavailableError`
 * for the routes, because only transfers imports capacity. For the same
 * reason the unavailability window routes and the window retention job
 * reach capacity through this file: transfers passes in its occupation
 * adapter and the audit append.
 * Search reads Transfers on every day by guest, Client reference, or flight
 * number. Today and later come first, earliest pickup first. Past
 * operational days follow, newest first. It is office-only. The query
 * text is not logged and not audited.
 * CSV export reads every Ride whose pickup falls on the chosen calendar
 * days. It is office-only. The log names the member, the range, and the
 * row count. It does not name a person or a place, and it writes no audit.
 */
export { RideOverlapError, RideUnavailableError, startUnavailabilityRetention, UnavailabilityArchivedError, UnavailabilityNotFoundError } from '../capacity'
export { acceptRide, acceptRideByPhone, AcceptRideInputError, RideNotAcceptableError } from './infrastructure/accept'
export { RideDriverArchivedError, RideNotFoundError, RideNotUnassignedError, RideVehicleArchivedError } from './infrastructure/assign'
export { assignRide, rosterVehicleForRide } from './infrastructure/assign-access'
export { cancelRide, CancelRideInputError, RideNotCancellableError } from './infrastructure/cancel'
export { correctTransfer, TransferNotCorrectableError, TransferNotFoundError } from './infrastructure/correct'
export { declineRide, DeclineRideInputError, RideNotDeclinableError } from './infrastructure/decline'
export { markRideDone, MarkRideDoneInputError, RideNotFinishableError } from './infrastructure/done'
export { listUpcomingRides } from './infrastructure/driver-ride-access'
export { FailedMailInputError, FailedMailNotFoundError, resendFailedMail } from './infrastructure/failed-mail'
export { askFlightLandings, LandingTimeClosedError, LandingTimeInFutureError, recordLandingTime, refreshFlightLandings } from './infrastructure/flight-landing'
export { startFlightLandingWorker } from './infrastructure/flight-landing-worker'
export { RecordLandingInputError, recordRideLanding, RideLandingClosedError, RideLandingInFutureError } from './infrastructure/landing'
export { closeMailOutboxQueue, mailOutboxQueue, mailOutboxStore, startMailOutboxWorker } from './infrastructure/mail-outbox-worker'
export { markNoShow, MarkNoShowInputError, NoShowTooEarlyError, RideNotNoShowError } from './infrastructure/no-show'
export { readOfficeHome } from './infrastructure/office-home-access'
export { changeVehicle, clearRide, reassignRide, RideNotOpenError, RideSameDriverError, RideVehicleUnchangedError } from './infrastructure/ride-change'
export { exportRides } from './infrastructure/ride-export'
export { createTransfer, listTransferDay } from './infrastructure/transfer-access'
export { searchTransfers } from './infrastructure/transfer-search'
export { StaleSaveError } from './infrastructure/transfer-version'
export { addUnavailability, changeUnavailability, listDriverUnavailability, listUnavailabilityWeek, listVehicleUnavailability, removeUnavailability } from './infrastructure/unavailability-access'
export { outboxAttemptStore } from './infrastructure/work-order-attempt'
