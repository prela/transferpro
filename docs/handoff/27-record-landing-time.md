# 27 Record a landing time

Out of scope: the flight-status feed, the expected-arrival notice, and marking a No-show.

## Decisions

- `POST /api/rides/:id/landing` takes `{ landingAt }`. An ISO instant records. `null` clears. Any other key is 400 before a session opens. A future instant is 409 `landing_time_in_future` and also opens no session.
- A dispatcher or an admin may record or clear it on an unfinished Ride, including `unassigned`. The assigned Driver may do it only while the Ride is theirs. Another Driver, and a Driver on an unassigned Ride, is 404. `done`, `no-show`, and `cancelled` are 409 `landing_time_closed`. The stored time stays. A refusal writes no audit row and does not change the Ride.
- The Ride state is not updated. No mail is sent.
- The same instant, or a clear when the time is already empty, writes nothing and appends nothing.
- The audit action is `ride.landing_recorded` for a record and for a clear. The actor is the person. Data is `rideId`, `driverId` (null when the Ride was unassigned), and `fields: ['landingAt']`. The instant is not stored.
- After review, `db/migrations/meta/_journal.json` `when` for `0033_ride_landing` is `1791400023000` (the previous entry plus 1000).

## Code review

Reviewed the uncommitted working tree against `origin/develop` (`git diff origin/develop`, plus the untracked command, route, screen, migration, and e2e spec). No commits at review time. The journal `when` below was corrected after this review.

## Standards

### Hard

**`db/migrations/meta/_journal.json`** — `when` is `1791789163546`. The previous entry (`0032_ride_declined`) is `1791400022000`. `docs/agents/working-rules.md` (Database roles and migrations) requires the new `when` to be the previous value plus 1000 (`1791400023000`). These values are synthetic; this one is a wall-clock timestamp. A larger value is still applied, so the breach is the rule, not a skipped migration.

### Checked, no breach

- Audit action `ride.landing_recorded`: value in `auditActions`, Zod shape (ids and `fields: ['landingAt']` only; no instant), `audit_entry_shape` branch in `db/audit-entry.ts` and `0033_ride_landing.sql`, snapshot enum plus that check, and `audit.actions` copy in `en.json` and `hr.json`. Matches working-rules Audit log, ADR-0014, and the Glossary audit-entry line.
- Append is `appendAuditEntry` on the tenant transaction after the write; a no-op writes nothing. Role allow-list is inside `recordRideLanding` (`driver` / `dispatcher` / `admin`, else 403). Body is Zod-parsed before the session. Imports are module `index.ts` barrels. Display still uses `formatInstant`. Both locales, Nuxt UI, labeled `size="xl"` input, Enter saves. `e2e/record-landing-time.spec.ts` covers Croatian plus an English pass and both themes.

Shotgun surgery across audit, locales, SQL, and UI is the documented four-place audit rule. Not a smell.

### Judgement

**Duplicated Code** — `RideLanding.vue` repeats the dialog error walk already in `RideAssign.vue` / `RideVehicle.vue`:

```34:64:app/components/RideLanding.vue
function httpStatus(error: unknown): number | undefined { ... }
function errorCode(error: unknown): string | undefined { ... }
function failureKey(error: unknown): LandingFailure { ... }
```

**Duplicated Code** — `canRecordLandingTime` is the same predicate as `canCancelRide` (`unassigned` | `assigned` | `accepted`). Separate names match ADR-0007 versus cancel, so merging them would be the wrong fix until the rules diverge.

`wallClockInTimeZone` is a second `Intl` formatter beside `formatInstant` (working-rules i18n: “do not add another date formatter”). It feeds `datetime-local`, and the table still renders with `formatInstant`. Treat as tension, not a breach.

## Spec

### (a) Missing or partial
None. Office can record and clear on an unfinished ride, including `unassigned`. The assigned driver can do both while the ride is theirs and unfinished. Another driver, and a driver on an unassigned ride, gets 404 and the stored time stays. `accepted` and `assigned` are not updated. `done`, `no-show`, and `cancelled` return 409 `landing_time_closed` with the time unchanged. The audit row’s actor is the member, and the who column shows that name. Refusals append no `ride.landing_recorded` row and do not change ride state. New copy is in `en` and `hr`; the dialog uses theme tokens. A future instant is rejected and no mail is sent (ADR-0028). An `accepted` ride is not returned to `assigned` (ADR-0010). Dispatcher, admin, and the assigned driver are the only roles allowed (ADR-0007).

### (b) Scope creep
“The audit log names the person who changed the landing time.” The row also stores the ride’s `driverId` (or null), and the detail cell shows that driver’s name. The spec only asks for the person who made the change.

### (c) Implemented but wrong
“A dispatcher or admin can record or clear a landing time” and “The assigned Driver can record or clear it” — “The change is audited.” A clear is written as `ride.landing_recorded`, labeled “Landing time recorded” / “Zabilježeno vrijeme slijetanja”. The actor is correct, but the log does not say the time was cleared.
