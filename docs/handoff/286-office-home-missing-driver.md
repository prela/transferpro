# 286 Office home missing decline Driver

Out of scope: the day board, a schema change, and the glossary.

## Decisions

- `loadDrivers` returns every Driver row. There is no deactivated or archived Driver.
- A decline id that is not in that list becomes `—`. The office home snapshot still returns. The mark is not a person's name and is not logged. A missing Client, current Driver, or Vehicle still fails the whole read.
- Owner decision 17.10.2026: no migration, no snapshot, no glossary edit, and no RLS test that deletes the Driver. The local database is back to `ride_alert.driver_id` `NOT NULL` and the previous foreign key. The unit test stays.
- No e2e spec changed. `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (553) passed. `pnpm test:e2e` on port 30286 passed 217 on the second full run. The first run failed three `e2e/ride-assign.spec.ts` listbox waits. Those three passed immediately afterwards.

## Code review

Fixed point `origin/develop`. The reports below are the review of `107f2fb`, before the unit test and before the owner decision that dropped the migration.

## Standards

Commit `107f2fb` on `feature/286-office-home-missing-driver-c77a`. Journal `when` is previous + 1000. No new audit action, no log of names, no `DELETE` grant, RLS left in place. ADR-0018 and ADR-0024 are unchanged: one office read, transfers-owned query.

### Hard

**`GLOSSARY.md` not updated** (`AGENTS.md`: update the glossary or an ADR when a term or a decision changes). **Decline alert** is still “naming that Driver.” This change stores a null `driver_id` after the Driver row is removed (`0041_decline_driver_removed.sql`, `db/ride-alert.ts`) and the office read returns a mark that the comment says is not a name:

```36:40:server/modules/transfers/infrastructure/office-home.ts
/**
 * Shown when the declining Driver is no longer in the catalog.
 * It is not a person's name, in either locale.
 */
const MISSING_DECLINE_DRIVER = '—'
```

### Judgement

**Primitive Obsession.** `driverName` is still a display string, and the missing Driver is the sentinel `'—'`, not its own value. `declineDriverName` returns that constant for a null id (`office-home.ts`).

**Speculative Generality.** The foreign key and the comment (“`loadDrivers` returns every Driver row”) make a non-null id with no catalog row unreachable, but the lookup still treats it as missing:

```160:163:server/modules/transfers/infrastructure/office-home.ts
function declineDriverName(id: string | null, names: Map<string, string>): string {
  if (id === null)
    return MISSING_DECLINE_DRIVER
  return names.get(id) ?? MISSING_DECLINE_DRIVER
```

**Schema vs SQL.** `working-rules.md` allows SQL drizzle cannot emit. The migration uses `ON DELETE SET NULL ("driver_id")`; `db/ride-alert.ts` and `0041_snapshot.json` record composite `"onDelete": "set null"`, which the migration comment says would clear `tenant_id`. A later generate will not see that difference.

## Spec

Issue #286 is largely met. A missing declining Driver no longer fails the office home read: `declineDriverName` returns `—`, and the new test covers an owner `DELETE` of that Driver, an HTTP 200, and the name absent from the snapshot and the audit.

### (a) Missing or partial

The tested path is not the failure the issue describes. "If that Driver is later removed or deactivated and `loadDrivers` no longer returns them, `requiredName` throws" and "Test: a decline by a Driver who is then deactivated/removed". The test deletes the row, and migration `0041` nulls `ride_alert.driver_id` first, so the read never looks the Driver up. `names.get(id) ?? '—'` (the id still stored, absent from `loadDrivers`) is untested. There is no deactivated-Driver column — `loadDrivers` returns every row — so "deactivated" is only a comment, not a case.

"No name in logs or audit." Audit text is asserted. Nothing asserts logs. The new path does not write the name.

### (b) Not asked for

Scope item 2 is "resolve inactive Drivers too, or fall back to a neutral label, without failing the read". The label is that fix. `0041` also makes `driver_id` nullable and `ON DELETE SET NULL (driver_id)`, so an owner delete of a Driver now succeeds and rewrites the alert. The app role still has no `DELETE` on `drivers`.

That null id changes the day read. `loadDeclineAlertsForDay` inner-joins `drivers` and requires a non-null `driverId` and a name, so the same removal drops the decline from the day board while office home still returns `—`.

### (c) Implemented, but wrong

None on the office home acceptance ("Office home read never fails because a declining Driver left the catalog."). Null and unknown ids both become `—`, and that string passes the decline schema.

## After that review

The owner dropped the migration, the snapshot, the glossary edit, and the RLS delete test. `office-home.test.ts` covers an id that `loadDrivers` does not return. The day board is unchanged.
