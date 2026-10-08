# 107 Office records acceptance by phone

Server, audit write, and the audit-log sentence. The day-list action is #100. Parent spec: #21. No Owner decisions comment was on #107. The enum value and the CHECK branch come from #99. No migration.

## Decisions

- `POST /api/rides/:id/accept-by-phone` allows only `dispatcher` and `admin`. A driver is 403. The body is empty. Any key, or a path that is not a Ride id, is 400 before a tenant session opens. No session with an empty body is 401. The Driver route `POST /api/rides/:id/accept` is unchanged.
- From `assigned` with the copied flag on, the Ride becomes `accepted`. The Driver, the Vehicle, and the flag are not rewritten. A Driver with no account is included: the Driver id is the Ride's, not a member link.
- The flag off, and every state other than `assigned`, leave the Ride unchanged and write no audit row. Both are 409 `ride_not_acceptable`. Another Tenant's Ride is 404 and writes no audit row.
- The write is the same update the Driver route uses: lock the Ride, then set `accepted` only while `state` is `assigned`, `must_accept` is true, and `driver_id` is the Driver already checked. A concurrent office accept against a Driver accept, or against a second office accept, has one winner. The loser is 409 and writes nothing.
- The audit action is `ride.accepted_by_phone`. The actor is the dispatcher or admin. `subjectUserId` is null. The data is `rideId`, `driverId`, and `fields: ['state']`. The row has no name, phone, plate, guest, or must-accept value.
- The audit screen's action sentence is `audit.actions.ride.accepted_by_phone` in Croatian and English. The detail cell is the office member's name plus that sentence. The plate is not joined, and neither is the Driver name. A departed member's actor name is null, so the detail cell is the sentence alone. Light and dark stay the current table.
- No mail.

## Out of scope

The day-list button and confirm modal (#100). Moving an accepted Ride back to `assigned`.
