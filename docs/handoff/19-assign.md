# 19 Assign a Driver and a Vehicle

Slice 1 is the database, the assign command, and the roster pre-fill. Slice 2 is the screens and e2e.

## Decisions

- The Ride stores `must_accept`, a copy of the Driver's setting at assignment. It is null while the Ride is `unassigned`. `assigned` requires a Driver, a Vehicle, and that copy. Later states are not constrained in migration 0019; this slice does not write them.
- There is no `assigned_at` and no `assigned_by`. The audit entry's actor and `occurred_at` are that record (ADR-0014).
- There is no transition table. The transition is one `UPDATE ... WHERE state = 'unassigned'`. A refusal updates zero rows and appends no `ride.assigned` entry.
- A Driver or a Vehicle from another Tenant is 404, the same as missing, because row security hides the other Tenant. 400 is only a body that does not name both ids. The composite foreign keys are the database backstop, on Rides and on the roster.
- Drivers have no archived or inactive column, so assignment does not refuse a Driver for that reason. An archived Vehicle is 409 `ride_vehicle_archived`. A Ride that is not unassigned, including the loser of a concurrent assign, is 409 `ride_not_unassigned`.
- `POST /api/rides/:id/assign` takes `{ driverId, vehicleId }`. The path is the Ride.
- `GET /api/rides/:id/roster-vehicle?driverId=` returns `{ vehicleId }` or `{ vehicleId: null }` when that local day has no row or the Vehicle is archived. It does not write. Assign still accepts any same-tenant Vehicle that is not archived. Changing the roster does not update a Ride.
- The pickup day is `calendarDateInTimeZone` of `pickup_at` in the Tenant time zone, the same instant the day list uses. It is not a `date` cast of the stored instant.
- Copy for the new codes: `ride.vehicleArchived` and `ride.notUnassigned`, in Croatian and English. The audit screen label is `audit.actions.ride.assigned`.

## Left for slice 2

The screens, in Croatian and English, in light and dark, and the Playwright spec. Reassign, clear, vehicle-only change, and decline are later commands (ADR-0005, ADR-0006).
