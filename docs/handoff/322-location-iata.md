# 322 Location IATA uniqueness

Out of scope: a flight-status provider, a flight status on a Ride, and a seed of real airport codes.

## Decisions

- The column stays `iata` from #173. It is not renamed to `iata_code`.
- The new migration is only `0042_location_iata_active`: a partial unique index on `(tenant_id, iata)` where `archived_at` is null and `iata` is not null. The check that the code is three uppercase letters stays in `0026_location_iata`.
- Before deploy to preview and production, run this query. It must return 0 rows, or the index will not apply:

```sql
select tenant_id, iata, count(*)
from app.locations
where archived_at is null and iata is not null
group by 1, 2
having count(*) > 1;
```

## Code review

## Standards

**Hard violations:** none.

Checked against `AGENTS.md` (tenant id from the session, public `index.ts` only, both locales, glossary when a decision changes), `docs/agents/working-rules.md` (journal `when` is the previous entry plus 1000; audit stays field name `iata` with no new action; the conflict error is the fixed phrase `Conflict` and is not rethrown with the Postgres text), ADR-0011 (index on existing `app.locations`, which already has `tenant_id` and forced row-level security; Tenant B may reuse the code and cannot see Tenant A’s row), ADR-0014 (no new audit action), ADR-0018 (transfers call `loadLocation` and `locationLabel` through `locations` / `shared` index files), ADR-0028 and ADR-0031 (optional airport-only code; maps columns untouched), and `GLOSSARY.md` (Location now states one active code per Tenant).

**Judgement — Duplicated Code.** The same lookup-then-label shape is copied in four components:

```82:85:app/components/OccupationStrip.vue
function placeName(id: string): string {
  const found = props.locations.find(location => location.id === id)
  return found ? locationLabel(found) : t('transfers.unknownPlace')
}
```

The same three lines appear in `TransferDayPrint.vue` (`place`), `TransferRideDetail.vue` (`place`), and `TransferRideRow.vue` (`placeLabel`). `locationLabel` in `shared/location.ts` is the right shared format; the find-or-unknown wrapper is still repeated.

## Spec

### (a) Missing or partial

No handoff file under `docs/handoff/`.

> "Handoff u docs/handoff/."

The set-and-remove end-to-end matrix is incomplete. On desktop, dark sets the code and runs axe, then light clears it and sets it again with no axe. Phone light and dark both set and clear, and axe runs only on the add dialog before save.

> "e2e: office korisnik postavi i ukloni IATA kod na lokaciji (light/dark, desktop/phone), axe prolazi."

### (b) Scope creep

None. The glossary line, the `409` / `location_iata_taken` copy, and appending the code on the driver ride and the work-order place follow the uniqueness rule and the ride-display line. The check constraint and the `iata` column stay the existing #173 / ADR-0028 field; this migration only adds the partial unique index and does not rewrite existing rows.

### (c) Implemented but wrong

The phone test treats the IATA table cell as proof that the code was stored and then cleared. That column is `max-lg:hidden`, and the phone second line (`locationSecondLine`) is kind and address only, so a phone user never sees the code in the list.

> "e2e: office korisnik postavi i ukloni IATA kod na lokaciji (light/dark, desktop/phone), axe prolazi."

After that review, the phone spec reads the saved code from the form and `GET /api/locations`, opens Locations through Više, and runs axe on the open form in light and in dark. The full end-to-end suite then passed.
