# 413 Fully booked

Out of scope: painting Popunjeno and the refusal dialog stay on #414. The duplicated fleet readers are #432.

## Decisions

- The fleet is a separate reader. An empty fleet makes a busy chosen pair fully booked, so existing capacity fakes stay valid.
- Fleet reads are serial. One session client cannot run them together.
- An idempotent create replay and a no-op correction return `fullyBooked: false`.
- Popunjeno is the board warning flag on an unfinished unassigned Ride. The slideover copy and the dialog with no confirmation stay on #414.
- The Driver and Vehicle id lists do not check a role. The caller already did, as `loadActivePartnerIds` does.
- Coverage of the capacity domain and application is unmeasured. No package was installed. No migration.
- After the review, the half-open overlap uses shared `intervalsOverlap`, and the route test compares the Transfer row. E2e specs that confirm an overlap or an unavailability keep a spare free Driver, Vehicle, or Partner, so they still open the existing confirmation. The reports below are verbatim, before that follow-up.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (926) passed. `pnpm test:e2e` passed (330, 6.3m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

Reviewed `feature/413-fully-booked` against `origin/develop`. The reports below are verbatim.

## Standards

### Hard

**ADR-0034** (`shared/capacity` is the one overlap judge). `windowsOverlap` copies private `intervalsOverlap`:

```71:76:server/modules/capacity/domain/fully-booked.ts
function windowsOverlap(from: Date, to: Date, ride: OccupyingRide, durationMinutes: number): boolean {
  const rideEnd = occupiedEnd(ride.pickupAt, ride.landingAt, durationMinutes)
  if (to.getTime() <= from.getTime() || rideEnd.getTime() <= ride.pickupAt.getTime())
    return false
  return from.getTime() < rideEnd.getTime() && ride.pickupAt.getTime() < to.getTime()
}
```

Same half-open rule as `shared/capacity.ts` (`intervalsOverlap`, lines 105–109). A later change to the judge will not move this copy.

**AGENTS.md** (Security: every loader that returns tenant data enforces the role allow-list itself). `loadActiveDriverIds` and `loadActiveVehicleIds` return tenant ids and do not check a role. `readFullyBooked` returns a tenant capacity fact and does not either. `readBoardFullyBooked` does (`admin` / `dispatcher`). `loadActivePartnerIds` already says the caller checked; that comment is not an ADR exception.

### Judgement

**Duplicated code.** `readFullyBooked` and `readBoardFullyBooked` (`server/modules/capacity/application/fully-booked.ts`) repeat the same shape: read the three id lists, treat an empty fleet with no Partner as booked, widen the occupation by the transfer duration, read windows, call `windowIsFullyBooked`. `driverTaken` and `vehicleTaken` are the same loop with the id field swapped (lines 47–65). `partnerCovered` repeats `freePartnerIds` in `domain/unavailability.ts`.

**ADR-0034** (“Transfers calls one capacity application service”). `transferFullyBooked` in `capacity-check.ts` calls `readFullyBooked` on the unassigned path and `judgeRideCapacity` when a pair is present. The board reader matches existing `readBoardOccupation`, so that split is the settled shape. The optional `fleet = noFleet` on `judgeRideCapacity` answers `fullyBooked` from an empty fleet when the caller omits it; the ADR says those ids come from `drivers`, `vehicles`, and `partners`. Overlap tests now expect `fullyBooked: true` from that default.

No glossary misuse (`fully booked` / `free` / Popunjeno). Imports stay on each module’s `index.ts`. The new RLS file does not show Tenant B’s fleet cannot clear Tenant A’s answer. Table RLS is unchanged; existing catalog tests still cover the policies.

## Spec

**(a) Partial**

“RLS, through the route: a 409 `fully_booked` leaves the Ride, the Transfer, the version, the audit log, and the mail outbox unchanged for each command, and `confirm: true` does not pass it.”

Assign, vehicle change, reassignment, handoff, and partner change all send `confirm: true` and expect `fully_booked`. The test compares the Ride row, the version, and audit and mail counts. It never reads the Transfer row. The concurrency test does snapshot that row; this per-command test does not.

The other acceptance lines are present: the verdict (any active Driver with any active Vehicle, roster ignored, Partners by unavailability only, the Ride left out, a free chosen pair never fully booked), refusal order, create and correct warnings including a confirmed move of an assigned Ride, board `fullyBooked` on unfinished unassigned Rides, the fixed interleaving in `capacity-lock.rls.test.ts` (no lock call asserted), the board route appearing and clearing, and the domain and application cases named in the ticket. No screen, e2e, or migration.

**(b) None**

Spare Drivers and Vehicles in older overlap tests keep a free pair so those cases stay `ride_overlap`. That follows “then `fully_booked`, then `ride_overlap`”. Idempotent replay and a no-op correction return `fullyBooked: false` without a capacity read; neither is a new save.

**(c) None**

`confirm` does not skip `fully_booked`. Corrections set `blockFullyBooked: false` and still throw `ride_overlap` or `ride_unavailable`. A tight gap does not count as taken, which matches ADR-0034’s free rule.
