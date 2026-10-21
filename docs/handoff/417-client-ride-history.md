# 417 Client Ride history

Out of scope: the screen, the Partner history, a migration, and an index.

## Decisions

- The read is `GET /api/clients/:id/ride-history` in `transfers`. `clients` does not import `transfers`.
- The page is 50 Rides, newest pickup first. The same pickup uses the Ride id descending. The cursor is that last row's pickup instant and Ride id.
- Counts are a second query over the whole history: total, done, No-show, and cancelled.
- `pickupWall` is the pickup in the Tenant time zone. `pickupAt` stays the stored instant.
- `partnerName` stays null until a Ride stores a Partner (#415). The row shape is the one that history will reuse.
- After the review, the SQL count row uses `rideHistoryCountsSchema`. The reports below are verbatim, before that.

## Code review

Reviewed uncommitted `feature/417-client-ride-history` against `origin/develop`. The reports below are verbatim, before the count-schema follow-up.

## Standards

**Hard:** none. The read stays in `transfers`, exported from `index.ts`. `clients` does not import it (ADR-0036, ADR-0049). The route matches `note.get.ts` (parse the id, Zod on the body, HTTP mapper). The loader matches `transfer-search.ts`: query parsed before `withTenantFromSession`, `officeOnly` for admin or dispatcher, raw SQL only in infrastructure, names via `loadClient` / `loadLocations` / `loadDrivers`, `hideDatabaseError`, no audit on a read. Counts and order match the glossary **Ride history** term and ADR-0049 (every state, newest pickup first, 50 per page, total / done / No-show / cancelled, no `client_id` index). `listClientRideHistory` enforces the role allow-list itself (`AGENTS.md` Security).

**Judgement — Speculative Generality.** `partnerName` is hard-coded null so a later Partner history can reuse the row. This slice has no handoff.

```126:129:server/modules/transfers/infrastructure/ride-history.ts
      // Handoff is not stored yet. The Partner history reuses this row (#415).
      partnerName: null,
      price: toPrice(row.price),
      payment: row.payment,
```

The same forward reference is on `rideHistoryRowSchema` and the transfers `index.ts` comment.

**Judgement — Duplicated Code.** The count shape is declared twice, field for field: `rideHistoryCountsSchema` in `shared/ride-history.ts` and `countRowSchema` in `ride-history.ts` (`total`, `done`, `noShow`, `cancelled`). The SQL row can be parsed with the shared schema.

## Spec

**(a) Missing or partial**

None. The diff adds an office read in transfers (`listClientRideHistory` on `GET /api/clients/:id/ride-history`), inside the Tenant session. Zod checks the query before a session opens. A Driver is 403, no session is 401, and an unknown or other-Tenant Client is 404. Rows are every state, newest pickup first, 50 per page, with whole-history counts (total, done, No-show, cancelled). `pickupWall` is the Tenant time zone. The shared row schema is what a Partner history can reuse. The clients module does not import transfers. RLS route tests cover tenant scope, every state, order, the cursor, counts, 401, 403, and 404. No migration, index, screen, or e2e.

**(b) Scope creep**

Each row includes `pickupAt`, a UTC instant. Spec: "The pickup is in the Tenant time zone" and "Each row: pickup date and time in the Tenant time zone". That value is `pickupWall`. The instant is not part of the asked shape.

`operationalDay` and `partnerName` are in scope. #363: "A row opens the Ride detail on its operational day" and "Driver or Partner name". #417: "The same shape is what a Partner's Ride history will reuse." `partnerName` is null because no Partner reference exists yet (#356 / #415).

**(c) Implemented but wrong**

None. The page is `pickup_at` descending, with ride id as the cursor tie-break. Counts are a separate query with no page filter. The role check runs before any Ride is read.
