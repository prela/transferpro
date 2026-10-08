# 97 Driver accepts a Ride

Server, audit, and glossary only. The phone control and `POST /api/rides/:id/accept-by-phone` are later tickets. Parent spec: #21. No Owner decisions comment was on #97 or #21; this slice follows the issue body and the parent implementation decisions that apply to the Driver route.

## Decisions

- `POST /api/rides/:id/accept` allows only `driver`. A dispatcher or an admin is 403. The body is empty. Any key, or a path that is not a Ride id, is 400 before a tenant session opens. No session with an empty body is 401.
- The Driver id is the Driver linked to the session member. The request has no Driver id. No link, another Driver's Ride, and another Tenant's Ride are 404. Nothing is written.
- An unassigned Ride has no Driver, so it is not "another Driver's Ride". That state, the copied flag off, and `accepted`, `done`, `no-show`, and `cancelled` on the caller's own Ride are 409 `ride_not_acceptable`. The Ride stays as it was. No audit row.
- The write locks the Ride, then updates it only when `state` is `assigned`, `must_accept` is true, and `driver_id` is the linked Driver. `driver_id`, `vehicle_id`, and `must_accept` are not rewritten. The loser of a concurrent accept gets 409 and writes nothing.
- The audit action is `ride.accepted`. `subjectUserId` is null. The data is `rideId`, `driverId`, and `fields: ['state']`. The row has no name, phone, plate, guest, or must-accept value. The actor is the Driver's member.
- The audit screen joins the Driver name from `driverId`. It does not join the plate. The action sentence is `audit.actions.ride.accepted` in Croatian and English. The detail cell is that name. Light and dark stay the current table.
- Migration `0021_ride_accepted` adds the enum value and replaces `audit_entry_shape` with the new branch. It does not add `ride.accepted_by_phone` and does not change `rides_accepted_pair`. Journal `when` is the previous value plus 1000.
- No mail.
- `server/core/import-gate.test.ts` keeps the same assertions. Its first test now allows 20 seconds. The ESLint load in that file exceeds the default 5 seconds when the pre-commit hook runs it after typecheck.

## Out of scope

The office route, the phone accept control, the day-list modal, and moving an accepted Ride back to `assigned`.
