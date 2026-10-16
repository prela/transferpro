# 248 Office home decline alert

Out of scope: the Pozornost block, the urgent count, and the Transfers day read.

## Decisions

- An unassigned row gains `declineAlerts`, an array of `{ driverName }`, empty when nobody declined. Waiting and in progress do not carry the field. A second decline stays, in `created_at` then id order.
- The Driver ids are aggregated in the same statement as the Ride rows, and only while the Ride is `unassigned`. The display name comes from `loadDrivers` on that same tenant transaction.
- Assignment does not delete the `ride_alert` row. The snapshot drops the alert because the Ride is no longer unassigned.
- `officeHomeUrgentKeys` stays the three marks already on the read. Decline keys wait for the Home rebuild.
- A missing catalog name still fails the whole read with `Office home read failed`. The name is not logged and not stored on an audit row.
- No migration, and no RLS policy or grant change.
- e2e: `pnpm exec nuxi build && pnpm test:e2e` — 198 passed. No spec changed.

## Code review

Fixed point `origin/develop`. The reports below are the review of the working tree before `723c450`. `requiredName` replaces the `driverName` helper the Standards review named.

## Standards

**Hard violations:** none.

The new path matches the docs that apply. Driver ids come back in the same office-home statement and names are resolved through `loadDrivers` (`docs/adr/0018-module-boundaries.md`, `docs/adr/0024-office-home-read.md`). Alerts stay on unassigned rows of any day and leave that list once the Ride is assigned again (`docs/adr/0039-urgent-and-warning-tiers-and-live-refresh.md`, **Decline alert** in `GLOSSARY.md`). `readOfficeHome` still refuses a non-office role before the read. The route parses `officeHomeSchema`. The read writes no audit row, and the error text does not carry a name (`AGENTS.md` audit and log ban). `OfficeHomeDecline` is exported from `shared/index.ts`.

**Judgement call — Mysterious Name.** `driverName` is the shared “id must resolve” lookup, but `named` uses it for vehicle plates as well as Drivers:

```125:136:server/modules/transfers/infrastructure/office-home.ts
function named(id: string | null, names: Map<string, string>): string | null {
  if (id === null)
    return null
  return driverName(id, names)
}

/** A set id with no catalog row fails the whole read. The name is not logged. */
function driverName(id: string, names: Map<string, string>): string {
  const name = names.get(id)
  if (name === undefined)
    throw new Error('Office home read failed')
  return name
}
```

`GLOSSARY.md` **Driver** is the person. A name like `requiredName` would match both call sites (`driverName: named(...)` and `vehiclePlate: named(...)`).

## Spec

Issue #248 against `git diff origin/develop` (working tree, no commits). No owner-decision comments on the issue.

### (a) Missing or partial

None. "An unassigned row carries the decline alert and the declining Driver's display name, for any day, from the same moment as the rest of the read. The shared response schema gains the field." `declineAlerts` (`driverName`) is required on each unassigned row in `officeHomeSchema`. Driver ids are aggregated in the same snapshot statement as the lists; the name is resolved with the other catalog names on that tenant transaction. The unassigned filter is not limited to the operational day, so today, tomorrow, and a later day all stay on the list.

"The alert ends when the Ride is assigned again, as today." The aggregate keeps alerts only while `r.state = 'unassigned'`, and `buildOfficeHome` copies them only onto that list. The `ride_alert` row is not deleted.

"Tenant A never sees Tenant B's decline alert; the read keeps its Admin and Dispatcher allow-list and refuses a Driver." `officeOnly` is unchanged. "No log or audit line carries the Driver's or the guest's name." The read still writes nothing; a missing catalog name throws `Office home read failed`.

"A shared test for the new field on the office home snapshot, and the office home RLS test extended" covers those cases, including the HTTP snapshot, driver 403, and stored audit text. No migration, policy, or grant is in the diff.

### (b) Scope creep

None. The diff is the office home read, the shared field, and those two tests. It does not add the Pozornost block, an urgent-count key, or a day-read change.

### (c) Implemented but wrong

None.
