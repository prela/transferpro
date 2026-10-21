# 415 Partner Ride history read, and the Partner contact on the office Ride read

Out of scope: a Partner history screen, an e2e spec, and a migration.

## Decisions

- A Partner's history is the Rides that Partner still holds, or closed while it held them. A take-back, or a change to another Partner, drops the Ride from the first Partner's history. QC accepted this on `0d29922`.
- Closing a handed-off Ride clears `partner_id`. The history query also matches the close audit's driver slot, where that Partner id is stored (ADR-0048). v1 adds no index.
- `GET /api/transfers` returns `partnerBriefs` (phone and email, not the note) for Partners a Ride that day is still handed to. The Driver's reads return none of it.
- `loadPartner` refuses a Driver before it reads the phone, the email, and the note. The history wrappers stay duplicated, and the audit select stays in transfers. QC accepted both judgement calls.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (898) passed. `pnpm test:e2e` passed (325, 4.5m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

Fixed point `HEAD` `fae8699`, the same commit as the merge-base with `origin/develop`. The review was the uncommitted working tree. Both subagents started with `fast=false`. QC passed on `0d29922`. The hard finding below was fixed in that commit, before QC. The reports are verbatim.

## Standards

**Hard.** `loadPartner` in `server/modules/partners/infrastructure/partners.ts` returns the Partner row, including phone, email, and note, and takes no role. `AGENTS.md` (Security): every loader that returns tenant data enforces the role allow-list itself and does not rely on the caller. ADR-0049: the Driver's phone shows none of the Partner phone or email. The only caller, `loadRideHistory`, calls `officeOnly` first and discards the row. `loadClient` is the same shape, but its comment records a Driver caller and a Client has no phone. `loadPartnerOfficeContacts` does refuse a driver.

**Judgement.** Duplicated code. `listClientRideHistory` and `listPartnerRideHistory` repeat the session, `officeOnly`, and the failure catch:

```243:259:server/modules/transfers/infrastructure/ride-history.ts
export async function listPartnerRideHistory(...) {
  const cursor = parseRideHistoryQuery(rawQuery)
  return withTenantFromSession(headers, async ({ actor, transaction }) => {
    officeOnly(actor.role)
    try {
      return await loadRideHistory(transaction, actor.role, { kind: 'partner', partnerId }, cursor)
    }
    catch (error) {
      if (error instanceof TenantAccessError || error instanceof PartnerNotFoundError)
        throw error
      // ... 'Ride history failed'
    }
  })
}
```

**Judgement.** `historyWhere` selects `app.audit_entry` from transfers (`(e.data->>'driverId')::uuid = ${partnerId}`) instead of `server/modules/audit/index.ts`. ADR-0018 and `AGENTS.md` reach another module through its `index.ts`; ADR-0036's allow-list does not name audit. This is a query, not an import. ADR-0048 stores the closed Partner id in that driver slot, and ADR-0049 makes the history an office read, so the select is the later decision. ADR-0014's "only an admin reads the log, through `GET /api/audit-entries`" is the weaker reading here: a dispatcher runs this query.

## Spec

No missing, partial, extra, or wrong behaviour against #415.

The partner history read reuses the Client history shape: same row fields, page of 50, cursor, and counts (total, done, No-show, cancelled), newest pickup first. Membership is the #409 Partner reference: `partner_id` while the Ride is still handed off, and the close audit’s driver slot after `partner_id` is cleared (ADR-0048). A take-back or a move to another Partner drops the reference, so those Rides leave this Partner’s history; that matches “by the Ride’s Partner reference,” not every past handoff. An archived Partner still resolves and still lists. Dispatcher and Admin are allowed; a Driver is 403 before any row; an unknown or other-Tenant Partner is 404. Query params are a strict Zod object, parsed before the session. `server/modules/partners` does not import transfers.

`GET /api/transfers` returns phone and email for Partners a Ride that day is still handed to, through `loadPartnerOfficeContacts` on the partners entry. The note is not included. An archived Partner stays on that list while the Ride still names it. The Driver’s day read is 403, and the upcoming read does not carry the contact. The new RLS tests cover tenant isolation, counts, archived history, 403, 404, the contact, and its absence on the Driver’s reads. No screen and no e2e. The one existing day assertion only gains `partnerBriefs`.
