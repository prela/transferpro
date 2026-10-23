# 454 nightly place-id refresh

Out of scope: the place check and the maps stay #453, #451, and #452.

## Decisions

- The tick is `place-refresh` at 03:00 UTC and is registered only when `MAPS=google`. `MAPS=none` returns before a queue or a pool exists.
- The per-Tenant job is `place-refresh-check`. Its payload is the tick instant only. `70c2048` stopped clamping that instant to the worker clock.
- The constant is `PLACE_REFRESH_CHECK`. The review below still names `PLACE_REFRESH_ASK`; that was the name in `6aef01f`.
- A replacement id is kept only when the trimmed value is 1..1024 characters. A blank or longer id is `invalid`, writes nothing, and is not in the log. A trim that equals the stored id is `same`.
- The port's `unavailable`, including `INVALID_REQUEST`, stays `unavailable`. The port does not say which failure it was.
- The breaker counts Locations in the batch whose kind is not `address`. It trips when those `gone` answers are more than half and at least 10. Exactly half does not trip. A trip writes no clear, of any kind, and logs one warning. `same` and `replaced` are still written. Held-back rows stay due.
- Every write matches the reference that was read, so an office pick in between wins. The address is not in the clear.
- No audit entry and no office notice.
- The issue said no migration. The app role cannot list other Tenants, so `0060_tenants_due_place_refresh.sql` adds a security-definer function that returns Tenant ids with a due reference. Journal `when` is the previous entry plus 1000. It was applied on `transferpro_e2e` for the RLS run, not on the dev database.
- The due rule is written in that function and again in the job select. The review names that copy. It is still in both places.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (974) passed. The first `pnpm test:e2e` could not find Chromium under the sandbox browser path. The rerun used `PLAYWRIGHT_BROWSERS_PATH` pointing at the installed browsers: one light hover contrast check failed on `.bg-inverted`, and the next full run passed (345, 5.8m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored). During implement, `pnpm test:rls` passed (437) on `transferpro_e2e`.

## Code review

## Standards

No hard breach of the cited rules.

Checked and aligned:

- `0060_tenants_due_place_refresh.sql` is `SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, returns tenant ids only, `REVOKE ALL FROM PUBLIC`, then `GRANT EXECUTE` to `transferpro_app`. The check handler does not call `set_config`; writes run on the queue session. That matches ADR-0011 for DML and the ADR-0052 nightly walk. Journal `when` is the previous entry plus 1000 (`working-rules.md`, Database roles and migrations).
- No audit row. ADR-0052 ("The refresh writes no audit entry") overrides the usual `appendAuditEntry` rule (`working-rules.md`, Audit log).
- The log line is counts plus `tripped`. Failures rethrow a fixed phrase so a Drizzle parameter list cannot sit on `Error.message` (`working-rules.md`, Logging and errors; ADR-0052).
- Zod covers the job registry (`place-refresh`, `place-refresh-check`), the listing rows, and the due select (`AGENTS.md`).
- Drizzle, `pg`, and `createPgBossJobQueue` stay in infrastructure. The plugin imports `server/modules/locations` (ADR-0018, `AGENTS.md`).

Judgement calls:

1. **Duplicated Code.** The due predicate is written twice. The migration has `place_ref_checked_at is null or place_ref_checked_at < p_now - interval '12 months'` with the active/google filters. `dueQuery` in `place-refresh.ts` repeats that predicate and adds `limit`. ADR-0052 defines one rule; nothing shares it.
2. **Mysterious Name.** `export const PLACE_REFRESH_ASK = 'place-refresh-check'`. The comment says the constant ends in `_ASK` so it sits with the other per-tenant jobs, but the string does not end in `-ask` or `-tenant`. `job-payloads.test.ts` special-cases `name === 'place-refresh-check'` beside `endsWith('-ask')`. `flight-landing-ask` did not need that.
3. **Duplicated Code.** `writeDecision` copies the same `where id / place_provider = 'google' / place_ref is not distinct from / archived_at is null` into the same, replaced, and gone updates.

No other baseline smell cleared the bar. The inline `{ checkPlaceRef }` shape is a narrowed port. The outcome `if` cascade is one function, and this repo does not use polymorphism for job outcomes.

## Spec

### (a) Missing or partial

The issue’s behaviour is in the diff: `place-refresh` at `0 3 * * *` only when `MAPS=google`; one `place-refresh-check` per due tenant whose payload is `askedAt`; both names in the job payload registry; the tenant-session select (active, provider `google`, `place_ref_checked_at` null or older than 12 months, nulls first, limit 100); same / replaced / gone (`NOT_FOUND` only) / unavailable writes; compare-and-set on the reference that was checked; the breaker (`gone >= 10` and more than half of non-address rows) writing no clear of any kind while still writing same and replaced; no audit entry and no office notice; log counts per outcome, `invalid` on its own, and `tripped`, with no reference; a replacement id kept only when trimmed length is 1..1024; Tenant A’s job leaving Tenant B unchanged.

Partial test. Spec: "An invalid-id answer or any failure changes nothing." A returned `unavailable` and a blank or too-long replacement are tested. A thrown `checkPlaceRef` is not, though `decide` catches it and writes nothing.

### (b) Not asked for

A migration, against "Tier: medium. No migration." `0060_tenants_due_place_refresh.sql` adds `SECURITY DEFINER` `app.tenants_due_place_refresh`, granted to `transferpro_app`, so the tick can list tenant ids. That copies "in the pattern of the flight-landing tick" (`tenants_due_flight_landing`). This issue still said no migration.

### (c) Looks wrong

Spec: "the payload is the tick's instant only" and "same sets the time; replaced writes the new reference and the time." `registerPlaceRefresh` sets `asOf` to the earlier of the payload and `now()`, and both the due predicate and `place_ref_checked_at` use `asOf`. The flight-landing worker uses the payload instant alone. If the payload is ahead of the worker clock, the window is not the tick’s instant and the stamp is wall time.
