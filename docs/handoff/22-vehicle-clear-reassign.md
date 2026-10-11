# 22 Change the Vehicle, clear a Ride, or reassign it

Out of scope: work orders for a change, a reassign, a clear, or a cancel.

## Decisions

- `POST /api/rides/:id/vehicle` takes `{ vehicleId }`. `POST /api/rides/:id/clear` takes an empty body. `POST /api/rides/:id/reassign` takes `{ driverId, vehicleId }`. The path is the Ride. A body ride id cannot name a different one.
- All three start from `assigned` or `accepted`. Any other state is 409 `ride_not_open` and writes nothing. A driver is 403 before a Ride is loaded.
- A vehicle-only change writes `vehicle_id` only. The state and the copied flag stay. It does not read `app.drivers`. The same Vehicle is 409 `ride_vehicle_unchanged`.
- A clear sets `unassigned` and nulls the Driver, the Vehicle, and `must_accept` together. The audit ids are the ones that were removed.
- A reassignment to the same Driver is 409 `ride_same_driver`. A different Driver becomes `assigned`, and `must_accept` is that Driver's setting at the call, including when the Ride was `accepted`. The audit names the new Driver, not the previous one.
- An archived Vehicle is 409 `ride_vehicle_archived` on a change and on a reassignment, the same as assign.
- The actions are `ride.vehicle_changed` (field `vehicleId` only), `ride.cleared`, and `ride.reassigned` (the four assignment fields). No work order is sent.
- The upcoming list is the unfinished Rides whose `driver_id` is that Driver. A clear or a reassignment drops the previous Driver because the id changes in the same update.

## Code review

## Standards

Reviewed uncommitted `feature/22-vehicle-clear-reassign` against `HEAD` (`git diff HEAD`, untracked files included). No commits.

### Hard

None. Audit actions have the Zod shape, the `audit_entry_shape` branch, migration `0027` (journal `when` is previous + 1000), and both locale strings (working-rules, Audit log). Appends run on the action transaction with ids and field names only (ADR-0014). Routes parse with Zod before `withTenantFromSession`, and `officeOnly` allows only admin and dispatcher (AGENTS.md; ADR-0005). Drivers, Vehicles, and audit are imported from each module `index.ts` (ADR-0018). Both locales, Nuxt UI controls, and `e2e/ride-change.spec.ts` (Croatian flow plus an English dark smoke) are present (working-rules, i18n; ADR-0016; AGENTS.md). Work-order mail is correctly absent (handoff 166).

### Judgement

**Duplicated Code.** `officeOnly` in `ride-change.ts` is the same check as `assign-access.ts`:

```ts
function officeOnly(role: string): void {
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}
```

`rideCleared` and `rideReassigned` in `shared/audit-entry.ts` are the same object except the action literal, in a file that already extracts `tenantPlatformAction` for that shape. `RideVehicle.vue` and `RideReassign.vue` each copy `httpStatus`, `errorCode`, and `failureKey`. `RideReassign.vue` also copies the roster prefill (`fillTicket`, `prefillVehicle`, `fromRoster`) from `RideAssign.vue`. `closeVehicleChange` and `closeReassign` in `TransferDay.vue` are the same focus-restore.

**Mysterious Name.** `keptRows` is the vehicle-change `RETURNING` schema (state stays `assigned` or `accepted`). `runStep` is only `hideDatabaseError` around `transaction.execute`.

## Spec

### (a) Missing or partial
None. Each acceptance line is in the diff.

- "A Vehicle-only change with the same Driver leaves the state and the copied flag unchanged" — `changeRideVehicle` sets only `vehicle_id`. Assigned stays assigned; accepted stays accepted; `must_accept` is not written and drivers are not read.
- "Clear from assigned or accepted returns the Ride to unassigned and clears the Driver and the Vehicle" — both states, `driver_id`, `vehicle_id`, and `must_accept` null (required by `rides_unassigned_open`).
- "Reassignment sets the new Driver and a Vehicle, copies that Driver's current must-accept setting, and moves the Ride to assigned, including from accepted" — `driverMustAcceptForAssign` (`for share`) is written, state becomes `assigned`.
- "The previous Driver's upcoming list no longer includes the Ride as soon as it is cleared or reassigned" — `loadUpcomingRidesForDriver` is `driver_id` plus assigned/accepted. The RLS test checks both the old and the new driver after reassign, and the new driver after clear.
- "The audit log names the person who changed the Vehicle, cleared, or reassigned" — `actorUserId` on `ride.vehicle_changed`, `ride.cleared`, and `ride.reassigned`; the log's who column is that member.
- "A driver is refused for all three, and the Ride is unchanged" / "A refused command writes no transition" — `officeOnly` returns 403 before any update; the RLS test shows the row still accepted and no change audit.
- "The screens this ticket ships are in Croatian and English, in light and dark" — both locale files, and the new screens use theme tokens. Croatian light runs all three actions; English dark opens the vehicle form.

Work-order mail is not sent. That matches the #166 handoff and is not a miss.

### (b) Scope creep
- Reassign pre-fills a Vehicle from the roster (`RideReassign.vue` → `/roster-vehicle`). The issue only says a dispatcher reassigns "to a different Driver and a Vehicle."
- Two refusals the issue and ADR-0005 do not state: the same Vehicle is 409 `ride_vehicle_unchanged`, and an archived Vehicle is 409 on change and reassign (assign already refused archived vehicles).

Same-driver 409 matches "a different Driver." Admin as well as dispatcher matches ADR-0005 ("The Dispatcher and the admin assign, clear, reassign, change the Vehicle").

### (c) Implemented but wrong
None. Clear stores the removed driver and vehicle ids and not the flag value. Reassign stores the new driver and does not store the previous one, which matches the glossary line added here. A vehicle-only change does not drop the ride from that driver's upcoming list, because the driver id is unchanged.
