# 411 Partner unavailability

Out of scope: painting the warning stays on the screen ticket; the hard block (`fully_booked`) stays on its later slice. No screen and no e2e in this ticket.

## Decisions

- `ScheduleResource` stays driver or vehicle. Unavailable resources add `partner`, so overlap types do not widen.
- `freePartners` is exported and tested. Handoff does not call it. A handed-off Ride does not occupy the Partner.
- The day-board Ride includes `partnerId` so the warning is derived on read. The screen paints it later.
- The audit check accepts older rows that have no `partnerId`. New writes always include it, nullable. The entry stores the window id, the Partner id, and field names, never the instants.
- A window reads Partner presence without a row lock. Handoff still takes `for share`.
- Coverage of the capacity domain and application is unmeasured. No package was installed.
- After the review, the journal `when` for `0058_partner_unavailability` is the previous entry plus 1000 (`3e5ee29`). The reports below are verbatim, before that follow-up.

## Code review

Reviewed `feature/411-partner-unavailability` against `origin/develop`.

## Standards

### Hard

**`db/migrations/meta/_journal.json`** — `0058_partner_unavailability` sets `when` to `1792600397882`. The previous entry (`0057`) is `1791400047000`. `docs/agents/working-rules.md` (Database roles and migrations): "set the new entry's `when` to the previous entry's `when` plus 1000." That value is `1791400048000`. Entries through `0057` follow that synthetic step; this one is a wall-clock timestamp.

No other documented breach. The new column stays on the existing tenant table (composite partner foreign key, `num_nonnulls(...) = 1`, no new `DELETE`). Audit data is still ids and field names, with no instants. Capacity imports `partners` through `index.ts`, and the allow-list matches ADR-0034. The new GET goes through `listUnavailabilityOf`, which calls `officeOnly`. Cross-tenant read/write is covered in `partner-unavailability.rls.test.ts`.

### Judgement

**Duplicated Code** — `partnerPresence` copies `partnerPresenceForHandoff` (and the same select in `partnerIsActive`), without `for share`:

```typescript
select archived_at as "archivedAt" from app.partners where id = ${partnerId}
// … missing → 'missing'; else active vs archived
```

**Speculative Generality** (and **Middle Man**) — `freePartners`, `freePartnerIds`, and `tenantActivePartnerIds` are exported and tested, and nothing in the diff calls them. The comment says "The hard block uses this later." ADR-0034 already defines a free Partner and puts that block last, so the unused wiring is the smell:

```typescript
export function tenantActivePartnerIds(transaction: TenantTransaction): ActivePartnerReader {
  return () => loadActivePartnerIds(transaction)
}
```

**Repeated Switches** — the same `driver` / `vehicle` / `partner` cascade is copied in `ownerOf`, `unavailabilityPorts`'s `presence`, `ownedBy`, the fake `liveOf`, and `parseRecordUnavailability`.

## Spec

**(a) Missing or partial.** None. The diff covers the migration (`partner_id` nullable, composite foreign key with `tenant_id`, check is exactly one of Driver, Vehicle, and Partner, no rewrite, no new `DELETE` grant), the #355 add, change, remove, and per-Partner read routes (office role, session Tenant, Zod, Tenant capacity lock), the existing window audit actions with window id, Partner id, and field names only, the `partners` allow-list through that module's public entry, handed-off Rides on the occupation port and on a saved Partner window, 409 `ride_unavailable` with `confirm: true` on handoff and Partner change, the free-Partner rule, the board warning derived on read, retention past 90 days, the named unit tests, and the RLS route tests. No screen, no e2e, and no `fully_booked`.

Refusal order matches ADR-0034: role and input, then `stale_save`, state, and archived, then `ride_unavailable`. The Tenant lock sits after the Ride row lock and before the Partner read. `fully_booked` is not inserted. "The order follows ADR-0034." "Hard block (`fully_booked`) must NOT be implemented."

**(b) Scope creep.** The day-board ride now includes `partnerId` (`shared/transfer.ts` and the day query). The spec asks the board read to return the unavailability warning, and says painting it is the screen ticket. "No screen in this ticket."

**(c) Implemented but wrong.** None.
