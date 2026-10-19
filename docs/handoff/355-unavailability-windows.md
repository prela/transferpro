# 355 Unavailability windows for Drivers and Vehicles

Out of scope: Partner windows and the Partner handoff check (#206 step 21a-P), `fully_booked` and Popunjeno, and any detail page. The owner decision of 19.10.2026 puts the window list and form into the existing Driver and Vehicle edit panels.

## Decisions

- Table `app.unavailability_windows` (migration `0049`): `driver_id` and `vehicle_id` are nullable composite foreign keys with `tenant_id`, `num_nonnulls(...) = 1`, `starts_at < ends_at`, and `removed`. There is no reason or kind column. The table is FORCE RLS with `tenant_isolation` (USING and WITH CHECK) and REVOKE ALL FROM PUBLIC.
- The only DELETE grant goes to `transferpro_app`, because the retention job runs as that role, the same precedent as the mail outbox. A RESTRICTIVE policy, `unavailability_windows_retention_delete`, lets a delete reach only windows that ended more than 90 days ago by the database clock. No route deletes; remove is a soft mark.
- The retention job follows the mail outbox pattern on its own pg-boss queue: a daily tick at `30 3 * * *` UTC, then one job per Tenant. Tenants are listed by the security definer `app.tenants_with_unavailability_ended_before`, which returns ids only. The job logs `unavailability.retention_deleted` with the count only.
- Routes (office only; the Tenant comes from the session):
  - `POST /api/unavailability`
  - `PATCH /api/unavailability/:id`
  - `POST /api/unavailability/:id/remove` (204)
  - `GET /api/unavailability?week=<Monday>` (the roster week, in the Tenant zone)
  - `GET /api/drivers/:id/unavailability` and `GET /api/vehicles/:id/unavailability`
- Every write takes `lockTenantCapacity`. Add and change return `coveredRides`, the assigned or accepted Rides that the window now covers.
- An archived Driver or Vehicle cannot get a new or a moved window (409 `unavailability_archived`). Its windows are still listed, and removing one is allowed. The panel shows them read-only, like the rest of the archived record.
- Audit actions `unavailability.added`, `unavailability.changed`, `unavailability.removed` store the window id, the Driver or Vehicle id, and field names: `['startsAt','endsAt']`, the moved subset, or `['removed']`. They never store the instants. A change to the same instants writes and audits nothing.
- Capacity: `judgeRideCapacity` reads the windows through the `windows` port, and `CapacityVerdict.unavailable` is present only when it is non-empty. Transfers throws `RideUnavailableError` (409 `ride_unavailable`) before `RideOverlapError`, so when both apply the code is `ride_unavailable`. `confirm: true` passes both.
- The board warning `unavailable: ['driver' | 'vehicle']` is derived on read by `readBoardUnavailability`, in one query, and only for assigned or accepted Rides. It shows as Nedostupan / Unavailable at the Warning tier, with the icon `i-lucide-calendar-off`.
- Confirmation dialog: `RideOverlapDialog` takes `reason` (`overlap` | `unavailable`) from `capacityConfirmReason(code)`. The ADR-0012 body carries only the code, so the unavailable copy says that the same confirmation also covers an overlap.
- UI: the section `UnavailabilityWindows.vue` sits in the edit panel, outside the record's own `UForm`. The whole-day shortcut (`wholeDaysWindow`) is on by default. `wholeDaysOf` shows a midnight-to-midnight window as days and reopens it with the shortcut on. The roster week grid reads `GET /api/unavailability?week=` and marks "Vozač nedostupan", and "Vozilo nedostupno" for the cell's roster Vehicle. Any Vehicle away that day carries "(nedostupno)" in the picker. A window does not block the roster.
- The covered-Rides notice is a neutral alert with an icon. The warning-coloured subtle alert failed axe contrast in light mode.
- Coverage is unmeasured. No coverage provider is installed.

## Test edits flagged

- `server/modules/mail/infrastructure/retention.rls.test.ts`: the pinned DELETE grant list gains `app.unavailability_windows transferpro_app`. Nothing else changed.
- Additive only. These files get new cases, and the only removed lines are imports widened to bring in new names. No assertion changed or was removed:
  - the domain `errors.test.ts` and `judge-ride.test.ts`;
  - `server/api/rides/http.test.ts` and `server/api/transfers/http.test.ts`;
  - `shared/board-warnings.test.ts`, `shared/ride-attention.test.ts`, and `shared/audit-entry.test.ts`.

## Code review (since bf18043)

- **Spec:** every criterion is covered.
  - Fixed: a Vehicle window that nobody has on the roster now shows in the roster picker. A new RLS case proves that `coveredRides` includes an accepted Ride.
  - Owner checks: the DELETE grant goes to the shared app role, held by the restrictive policy. `unavailability_archived` is extra to the spec. The verdict names the kinds (`driver`, `vehicle`), not ids, which is enough for one Ride.
- **Standards:** no hard violation. Judgement calls left as they are:
  - The retention starter repeats the mail one. It has no close hook, because no test starts it and production stops with the server.
  - The `confirmReason` branch repeats in the four confirming forms.
  - `RideOverlapDialog` keeps its name.
  - The optional `unavailable` fields keep the existing exact-equality tests unchanged.
  - The `driverId`/`vehicleId` pair is the table's shape.

## Open questions

- The dialog cannot say "both" when an overlap and a window apply together, because the 409 body carries only `ride_unavailable`. Saying "both" would need a second code or a field outside ADR-0012.
- The covered-Rides list shows pickup times only, with no guest or place, to keep the response free of names. The Ride is found on the board by its warning.
