# 379 Partner module A

Out of scope: the Partner screen and its end-to-end spec stay in part 2; capacity's allow-list stays for #357.

## Decisions

- `partner.changed` is one audit row whose `fields` array lists every changed field, in canonical order. Archive and restore store the Partner id only.
- `loadActivePartnerIds` and `partnerIsActive` return ids and do not re-check the office role. The HTTP routes do, the same shape as `driverIsInTenant`.
- After the review, the partners lint message cites ADR-0036 and ADR-0049. The duplicated lint rule and the duplicated field-list combinator stay as written.

## Code review

## Standards

**Hard violations:** none.

`0051_partners.sql` matches the tenant-table rules in `AGENTS.md` and `docs/agents/working-rules.md`: `tenant_id` defaults to `app.current_tenant_id()`, `ENABLE` plus hand-written `FORCE ROW LEVEL SECURITY`, `tenant_isolation` with `USING` and `WITH CHECK`, `REVOKE ALL FROM PUBLIC`, and `SELECT, INSERT, UPDATE` only. Journal `when` is the previous entry plus 1000. The four audit pieces are present: `auditActions` and strict shapes in `shared/audit-entry.ts`, `audit_entry_shape` branches in `db/audit-entry.ts`, enum values and the replaced check in the migration, and `audit.actions.partner.*` in both locales. Entries store `partnerId` and field names. Archive and restore store the id only. Writes go through `hideDatabaseError`, so a phone, email, or note in a driver error is not rethrown. Routes parse bodies, ids, and `includeArchived` with Zod and allow only `admin` or `dispatcher` (`officeOnly` in `partner-access.ts`), which matches ADR-0049. Imports stay on module `index.ts` files. Partners do not import transfers.

**Judgement call (documented rule, not a hard breach):** `loadActivePartnerIds` and `partnerIsActive` in `server/modules/partners/infrastructure/partners.ts` return tenant rows and do not take a role. The comment says the caller already checked. `AGENTS.md` says every loader that returns tenant data enforces the allow-list itself. The HTTP routes do. These two match the ADR-0034 id port (`driverIsInTenant` is the same shape), so the route rule holds and the helper sentence does not.

**Smells (judgement):**

- **Duplicated Code.** `partnersTransfersImport` in `eslint.config.mjs` repeats `clientsTransfersImport` (same visitors, only the directory and the message change). The message cites ADR-0036; the partners sentence is ADR-0049. Fix: one rule parameterized by module path, and cite ADR-0049.
- **Duplicated Code.** `fieldLists` in `shared/partner.ts` repeats the bit-mask in `shared/contact-person.ts`. Fix: one combinator both field-list schemas call.

## Spec

**(a) Missing or partial**

None. The diff covers every acceptance line in #379: the Partner table and checks, `FORCE ROW LEVEL SECURITY`, `tenant_isolation` with `USING` and `WITH CHECK`, `REVOKE ALL FROM PUBLIC`, no `DELETE` grant, unique `(tenant_id, id)`, and the four audit actions; office routes for list (archived on request), create, correct, archive, and restore, with the tenant from the session, the Dispatcher/Admin allow-list, strict Zod bodies, and a refusal to correct an archived Partner; audit rows that store the Partner id and field names only; the public entry (`loadActivePartnerIds`, `partnerIsActive`) and the partners-must-not-import-transfers lint; a cross-tenant read/write RLS test; and unit plus route tests. Capacity’s allow-list is left for #357.

**(b) Scope creep**

None. Audit-log labels in `AuditLog.vue` and the locale files are the existing log rendering the new actions, not the Partner screen. The extra lint that stops `transfers` from deep-importing `partners` infrastructure is the same catalog boundary as Clients, Locations, and Vehicles.

**(c) Implemented incorrectly**

None. Phone and email use the Driver schemas and the same database checks, and are optional. The name is trimmed, 1–200, and not unique. The note is optional, trimmed, and at most 2000. Archive and restore do not delete. Created and changed audit rows list field names; archived and restored rows carry only the Partner id.
