# 328 Mail outbox

Out of scope: retries, the current-ness check, the idempotency key, the Home block, invitations, and the 90-day delete (#329–#332).

## Decisions

- Every work-order send is written on the Ride transaction. The action waits for one attempt after commit. Success is `sent`. A rejection leaves the row `pending` and counts the attempt. A blank Driver email writes no row.
- The office wire value stays `failed`. The sentence says the send will be tried again and names the Driver.
- The first attempt sends the snapshot read on the Ride transaction. The owner accepted that sentence. A "no longer yours" row stores the released Vehicle in `vehicle_id`. The shape check is `work_order_status = 'no_longer_yours' or vehicle_id is null`.
- A failure while noting the attempt is logged as `{ event: 'mail_outbox.note_failed', entryId }` and the office still gets the notice.
- `pnpm test:rls` on the dev database `transferpro` fails only `refuses an assigned work order that names a vehicle`, because `0045` is already applied there. The other 314 RLS tests passed. CI `slow` builds the database from scratch.
- `origin/develop` was already contained in this branch.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (640). `pnpm test:e2e` passed on the retry: 272 (3.6m), database `transferpro_e2e` only. The first full run failed one unrelated listbox open in `e2e/transfers.spec.ts`; the retry was green. `pnpm audit --audit-level=high` exited 0.

## Code review

Fixed point `origin/develop`, including the uncommitted shape-check delta. The reports below are that review.

### Standards

No hard breach. The new tenant table matches `AGENTS.md`: `tenant_id`, `FORCE ROW LEVEL SECURITY`, `tenant_isolation` with `USING` and `WITH CHECK`, `REVOKE ALL FROM PUBLIC`, and `SELECT`/`INSERT`/`UPDATE` only. The journal `when` is the previous value plus 1000 (`docs/agents/working-rules.md`). Instants are `timestamptz`. Transfers import `server/modules/mail/index.ts` (`docs/adr/0018-module-boundaries.md`). The write is Zod-parsed, logs carry ids and an error type, both locales changed, and `e2e/work-order-assign.spec.ts` covers the notice in light and dark.

**Judgement.** `deliverStagedWorkOrder` opens its own `withTenantFromSession` and never reads `actor.role`. `AGENTS.md` says every helper that returns tenant data enforces the role allow-list itself. `withTenantFromSession` only requires admin, dispatcher, or driver (`docs/agents/working-rules.md`). Assign, cancel, correct, clear, and reassign call `officeOnly` on the earlier session, and this helper is not a route, so a driver cannot reach it through those entry points. The second session does not repeat that check.

**Duplicated Code.** The same outbox cleanup is copied into the RLS `beforeAll` blocks, `transfer.rls.test.ts`, and `demo-seed.ts`:

```sql
delete from app.mail_outbox where tenant_id::text in (
  select id from auth.organization where slug like 'hbw-%'
)
```

**Shotgun Surgery** is the same scatter: one foreign key forces that delete into every fixture that removes rides. A shared cleanup helper would gather it. Cascading deletes would fight the no-`DELETE`-grant rule, so that is not the fix.

Invitation columns, `failed`/`stale`, and `next_attempt_at` look like speculative generality. ADR-0045 says those columns land in this migration, so that smell is suppressed.

### Spec

The uncommitted check matches the 18.10 decision: `0045_mail_outbox.sql`, `db/mail-outbox.ts`, and the snapshot all add `and (work_order_status = 'no_longer_yours' or vehicle_id is null)`, and `outbox.rls.test.ts` expects `23514` for an assigned row with `vehicle_id`. Retries, current-ness, the idempotency key, Home, invitations, and retention (#329–#332) are not built.

**(a) Missing or partial**

- **Release note is not in a PR.** #328: "Release note in the PR: merge the next ticket before the next release from `develop`, because until then a failed first attempt is not retried." That sentence is only in ADR-0045 consequences. There is no pull request body.

**(b) Scope creep**

None. The ADR's retry, Home, and retention text is the #328 requirement to write ADR-0045 "as described in #325". `vehicle_id` is the binding 18.10 shape, not an extra feature.

**(c) Implemented but wrong**

- **The first attempt is not composed from current rows.** #328: "The mail is composed at that moment from the current rows (Driver email, Ride, Tenant locale and time zone)." #325: "Every attempt composes the mail from the current rows … so the content is never stale." `deliverStagedWorkOrder` sends the snapshot read inside the Ride transaction. ADR-0045 records that exception for "no longer yours"; assigned, changed, and cancelled still skip a post-commit read.
- **A failed note leaves the row wrong while the office is told the opposite.** #328: "Success sets `sent`." and "A failed attempt leaves the entry `pending` with its attempt count." If `noteWorkOrderAttempt` throws, the catch logs `mail_outbox.note_failed` and still returns `sent` or `failed`. The row stays `pending` with `attempt_count` 0.
