# 220 Office role on day-board warning reads

Out of scope: retrofitting older loaders such as `loadDrivers`.

## Decisions

- `loadDriverDocumentExpiry`, `loadVehicleDocumentExpiry`, and `rosteredDriversOnDates` take the session role and refuse anyone who is not an admin or a dispatcher before a query, including an empty id or date list. Callers pass `actor.role`. They do not open a session.
- This replaces the #212 line that said these three reads do not take a role. `listTransferDay` still calls `officeOnly` before `applyBoardWarnings`, and passes `actor.role` through.

## Code review

Reviewed `git diff origin/develop...HEAD` at `29c5a8f`.

## Standards

**Hard documented breaches:** none.

The three public loaders (`loadDriverDocumentExpiry`, `loadVehicleDocumentExpiry`, `rosteredDriversOnDates`) now refuse any role other than admin or dispatcher before a query, including an empty id or date list. That matches `AGENTS.md` (Security): a loader that returns tenant data enforces the allow-list itself. `TenantAccessError` is imported from each module’s `index.ts` (`docs/adr/0018-module-boundaries.md`). Warnings stay derived on read (`docs/adr/0032-board-warnings-derived-on-read.md`). No new audit payload or log line.

**Judgement call — Duplicated Code.** The same allow-list is copied in three files:

```31:36:server/modules/drivers/infrastructure/drivers.ts
function officeOnly(role: string): void {
  // Licence dates are office data. A driver is refused on this read.
  if (role === 'admin' || role === 'dispatcher')
    return
  throw new TenantAccessError(403)
}
```

The same function is in `server/modules/roster/infrastructure/roster.ts` and `server/modules/vehicles/infrastructure/vehicles.ts`. Each of those modules already has a private `officeOnly` in its `*-access.ts` (that copy refuses only `role === 'driver'`). `AGENTS.md` requires each loader to enforce the check; it does not require another copy of the predicate. While a session is only admin, dispatcher, or driver (`docs/agents/working-rules.md`, RLS and the tenant session), the two shapes match.

**Judgement call — `AGENTS.md` (Security).** `applyBoardWarnings` takes `role` but returns the rides without reading it when none are assigned or accepted:

```45:47:server/modules/transfers/infrastructure/board-warnings.ts
  const occupying = rides.filter(ride => ride.state === 'assigned' || ride.state === 'accepted')
  if (occupying.length === 0)
    return rides.map(ride => ({ ...ride, warnings: emptyBoardWarnings() }))
```

That path still relies on `listTransferDay`, which already calls `officeOnly`. It does not query. The occupying path is covered because the first loader throws before `loadNeighbours`.

## Spec

No findings.

**(a) Missing or partial.** None. "Each read enforces the office allow-list (admin or dispatcher) itself" is met: `loadDriverDocumentExpiry`, `loadVehicleDocumentExpiry`, and `rosteredDriversOnDates` each call a local `officeOnly` that returns only for `admin` or `dispatcher` and throws `TenantAccessError(403)` before the query. That is the allow-list in `transfer-access.ts`, which the acceptance line names. The deny-only-`driver` checks in `driver-access.ts`, `vehicle-access.ts`, and `roster-access.ts` would let any other role through, so they were not the shape to copy. `listTransferDay` passes `actor.role` through `applyBoardWarnings`. "Add RLS/integration tests showing a driver role is refused by each read" is met in `board-warnings.rls.test.ts`: a driver session gets 403 from all three reads. "No behavior change for office users; don't weaken any tests": the SQL is unchanged, office roles pass the new check, and the diff only adds a test.

**(b) Scope creep.** None. Threading `role` into `applyBoardWarnings` is the wiring those checks need. The dispatcher (all three) and admin (driver expiry) success assertions support "No behavior change for office users". Older loaders such as `loadDrivers` are untouched.

**(c) Implemented but wrong.** None. The check sits on the read, uses the session role, and refuses before a query, including an empty id or date list.
