# 453 place reference check time

Out of scope: the nightly job that applies same, replaced, and gone is #454.

## Decisions

- `place_ref_checked_at` is storage, not an office field. The Location schema and the route JSON do not carry it.
- A pick stamps `now()` in the same insert or update. A hand edit or a clear nulls it with the provider and the reference. A save that leaves the reference keeps the column. The clock is Postgres, not a JavaScript date.
- A null parameter in `is null` is cast to text. Postgres cannot infer the type otherwise.
- The Google check is Place Details (New), GET, field mask exactly `id`, on `MAPS_API_KEY`. `gone` is error status `NOT_FOUND` only. A 200 with a different id is `replaced` with the id Google sent, including a padded or over-long id. An empty id is `unavailable`. An invalid-id answer, a timeout, a refused key, a spent quota, and a server error are `unavailable`.
- The none adapter returns `unavailable` and does not call Google. The fake defaults to `unavailable` and returns whatever the test sets.
- Nothing schedules the check. The demo seed leaves the column null.
- The route suite pins `MAPS=google` for the Embed. A typed address still saves with a null reference and a null check time while the fake suggestions are off. The writer does not call the maps port.
- Journal `when` is the previous entry plus 1000.
- The spec finding in the review below (a padded or over-long id answered `unavailable`) was corrected in `801156f`. That commit also names the shared timeout `PLACES_TIMEOUT_MS`. The reports are verbatim from the review of `b568c19`.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (955) passed. `pnpm test:e2e` passed (338, 5.4m) on `transferpro_e2e`. The first e2e launch could not find Chromium. The rerun used the installed browsers. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored). During implement, the location RLS files passed on `transferpro_e2e`. One full RLS run failed an unrelated audit-order test that shares a timestamp; that file passed on a second run.

## Code review

## Standards

No hard breach of `AGENTS.md`, `docs/agents/working-rules.md` (migrations, RLS, logging), ADR-0018, ADR-0052, or ADR-0031.

The migration is one `timestamptz` column, journal `when` is the previous entry plus 1000, existing rows are not rewritten, and there is no new `GRANT` (table-level `SELECT`/`INSERT`/`UPDATE` from `0016_locations.sql` already covers the column; no `DELETE`). The check is `place_ref_checked_at is null or place_ref is not null`, so a reference with no timestamp stays due. A pick stamps `now()` in the same insert or update; a hand edit or a clear nulls it with the provider and the reference. Audit still records `placeRef` only. `checkPlaceRef` is on `MapsPort`; Google, fake, and none implement it. The request field mask is `id`, the response schema keeps only `id`, and nothing logs a reference, an address, or the key. RLS tests assert isolation and the check failure, not policy SQL. The change stays inside Locations.

**Judgement — Duplicated Code.** `readPlaceId` and `readErrorStatus` repeat the same parse-and-`safeParse` shape (already used by `mapSuggestions`):

```168:189:server/modules/locations/infrastructure/google-maps.ts
function readPlaceId(body: string): string | null {
  // JSON.parse + placeDetailsSchema.safeParse
}
function readErrorStatus(body: string): string | null {
  // JSON.parse + placeErrorSchema.safeParse
}
```

**Judgement — Mysterious Name.** The new Place Details call is bounded by `SUGGEST_TIMEOUT_MS`, whose comment still describes the suggestion form:

```114:118:server/modules/locations/infrastructure/google-maps.ts
signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
```

ADR-0052 requires the port operation, so `checkPlaceRef` with no office caller yet is not speculative generality. The file spread matches ADR-0018.

## Spec

**(a) Missing or partial.** None. The migration adds only nullable `place_ref_checked_at`, with the check that it is null when `place_ref` is null, and it does not rewrite rows, add a coordinate, `UPDATE`, or a grant. The writer stamps `now` on a pick or a new pick, clears the time with the provider and the reference on a hand edit or a clear, and keeps it when the reference stays. The Google check calls Place Details (New) for that reference with the field mask pinned to `id` on the server key, and the fake returns the outcome the test sets. Route tests cover the stamp, the keep, the clear, Tenant B, and a plain-text save while suggestions are off.

**(b) Scope creep.** None. `checkPlaceRef` on the none adapter is required by the new port. It returns `unavailable` and does not apply `same`, `replaced`, or `gone`. No nightly job.

**(c) Implemented wrong.** A 200 body whose `id` differs from the requested one, but is blank, padded, or longer than the stored-reference limit, is answered `unavailable`. The spec says the check "answers one of: `same`; `replaced`, with the new id" and reserves `unavailable` for "an invalid-id answer, a timeout, a refused key, a spent quota, a server error, or anything else." A successful details body with a different id is the `replaced` case. The new id is dropped.
