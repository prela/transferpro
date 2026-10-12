# 159 Driver lost Ride is 404

Out of scope: office accept-by-phone, and `done`, `no-show`, and `cancelled` on a Ride this Driver still holds.

## Decisions

- `POST /api/rides/:id/accept` returns 404 when `driver_id` is not the Driver linked to the session, including when a clear left it null. Nothing is written and no `ride.accepted` row is appended. A Ride this Driver still holds, with the copied flag off or in any state other than `assigned`, stays 409 `ride_not_acceptable`.
- A Ride that was never assigned has the same null `driver_id` as a clear, so it is 404 too. This path does not store who held it before.
- `POST /api/rides/:id/accept-by-phone` is unchanged. An unassigned Ride there is still 409.
- The phone treats 404 like 409: it shows the conflict alert and reloads the list, so the card drops. That follows ADR-0005. It was added after the review below.

## Code review

Reviewed uncommitted `fix/159-driver-lost-ride-404` against `origin/develop` (`git diff origin/develop`). No commits at review time. The hard Standards finding was fixed before commit: a 404 now reloads the list. The test title the review called mysterious was renamed.

## Standards

### Hard

**`server/modules/transfers/infrastructure/accept.ts` and `app/components/DriverRides.vue` — ADR-0005 (Decision and Consequences).** A Ride leaves the Driver's upcoming list as soon as it is no longer theirs, and the phone must drop it the moment it is taken. The new check hides a cleared or reassigned Ride as not found:

```104:105:server/modules/transfers/infrastructure/accept.ts
  if (current.driverId !== driver.id)
    throw new RideNotFoundError()
```

That used to be 409 when `driverId` was null. `accept()` reloads only on 409:

```90:94:app/components/DriverRides.vue
    // 409 is ride_not_acceptable: the flag is off, or this Driver's Ride is not assigned.
    // A Ride they no longer hold is 404 and does not use this alert.
    if (httpStatus(error) === 409) {
      conflict.value = true
      await loadRides(true)
```

The new comment records that 404 does not refresh. The docblock above `accept()` still says any other failure leaves the control so the Driver can try again. A cleared or reassigned Ride therefore stays on screen.

### Judgement

**`server/api/rides.rls.test.ts` — Mysterious Name.** The edited test is still named `refuses acceptance when the copied flag is off and from every state other than assigned`, but the unassigned case is now `expect(unassigned.status).toBe(404)`, while `done`, `no-show`, `cancelled`, and `accepted` stay 409.

**Same file — Duplicated Code.** The new test repeats one shape twice: assign, mutate, accept, `toBe(404)`, `not.toContain(phone)` / `not.toContain(guest)`, then `rideRow`. Quote: `const afterClear = await call(...)` … `expect(afterClear.status).toBe(404)` and `const afterReassign = await call(...)` … `expect(afterReassign.status).toBe(404)`.

No breach of ADR-0006, ADR-0018, the audit or logging rules, or the glossary. The route and function comments match the new 404/409 split. Replacing the unassigned 409 assertion is a contract change, not a weakened test.

## Spec

### (a)

None. “Driver gets 404 for a Ride they no longer own; no write” and “Covered by a test.”

`acceptAssignedRide` throws `RideNotFoundError` (404) when `driverId` is null (clear) or another Driver (reassign), before `writeAcceptedRide` and `appendAcceptance`. The new RLS test covers both, asserts 404, an unchanged row, and no `ride.accepted` audit.

### (b)

“When a Driver acts on a Ride that is no longer theirs (removed, reassigned, or otherwise lost), the API must return **404**.”

The same check now 404s a Ride this Driver never held. In `refuses acceptance when the copied flag is off and from every state other than assigned`, a Transfer created and never assigned used to expect 409 `ride_not_acceptable`; it now expects 404. The route comment adds “never theirs,” which the issue does not say. That row has the same null `driver_id` as a clear, so the lost-Ride fix cannot keep the old 409 without history this path does not store.

The `DriverRides.vue` edit is a comment only. Office accept-by-phone is unchanged.

### (c)

None. A Ride this Driver still holds, in another state or with the copied flag off, still throws `RideNotAcceptableError` (409) and does not write. Reassignment was already 404; the change is the null-driver case that used to fall through to 409.
