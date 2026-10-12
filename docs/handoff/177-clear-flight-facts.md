# 177 Clear live-flight facts

Out of scope: mail when a correction returns a Ride to assigned (#168), and any change to the No-show clock or the unclosed mark.

## Decisions

- A different flight designator clears `landing_at`, `expected_arrival_at`, `expected_arrival_basis_at`, `flight_will_not_arrive`, and `flight_will_not_arrive_handed` in the same correction. Spacing or case of the same designator stores the new spelling and clears none of those.
- That spacing or case edit leaves an accepted Ride accepted. Any other flight-number change, including a note changed to another note (`VIP` to `meet at desk`), still returns it to assigned. The Driver and the Vehicle stay.
- The trip-change RLS test in `server/api/transfers.rls.test.ts` used to expect a spacing edit to return the Ride and to append `ride.returned_to_assigned`. That assertion now expects the Ride to stay accepted, and only the later place-and-time change appends the return. The new designator, spacing, and finished-Ride tests cover the facts.

## Code review

## Standards

No hard breach of a documented rule.

`correct.ts` still imports Clients, Locations, tenancy, and audit through each module entry, and the designator predicate through the `shared` barrel (`docs/adr/0018-module-boundaries.md`; `AGENTS.md`, deep imports). The handler still refuses a non-office role itself. Audit rows stay ids and field names; the edited test still asserts the guest is absent (`AGENTS.md`; `docs/agents/working-rules.md`, Audit log). **Accepted** and **Expected arrival** were updated with the rule (`AGENTS.md`; `GLOSSARY.md`). Re-accept uses `flightNumberChangeClearsLanding`, the same designator test ADR-0028 already uses for the clear (`docs/adr/0028-live-flight.md`). Pickup, start, and end still return an accepted Ride; a vehicle-only change does not (`docs/adr/0010-reaccept-material-change.md`). The cross-tenant correction test is unchanged. No migration.

Glossary “case” matches the existing designator key (`ou 384` already shares a key). ADR-0028’s decision line says “spacing-only” and was not edited. That is narrower wording, not a new contradiction: the predicate this diff calls already folds case.

### Judgement

**Duplicated Code** — `server/api/transfers.rls.test.ts`. The designator test and the spacing/case test repeat the same tenant, driver, vehicle, accept, and `rememberLiveFlight` setup; only the patched number and the expected state differ. The file already copies that fixture per test, so extracting it is optional.

```907:938:server/api/transfers.rls.test.ts
it('clears live-flight facts when the flight designator changes, ...', async () => {
  const created = await tenant('htr-correct-designator', 'Hana Admin')
  // ... same driver, vehicle, assign, accept, rememberLiveFlight ...
```

```963:994:server/api/transfers.rls.test.ts
it('keeps live-flight facts and acceptance when only the flight designator spacing or case changes', async () => {
  const created = await tenant('htr-correct-spacing', 'Hana Admin')
  // ... same shape, flightNumber: 'ou384' ...
```

## Spec

The earlier bug is fixed. `correctionReturnsAcceptedRide` no longer follows `flightNumberChangeClearsLanding`. `VIP` to `meet at desk` returns an accepted Ride to assigned. `OU 384` to `ou384` does not.

**(a) Missing or partial.** None. On an unfinished Ride, `OU 384` to `OU 392` clears the expected arrival, the landing time, and the memory of what was already told (`expected_arrival_basis_at`, plus the will-not-arrive fact and its handed flag) in the same update, and an accepted Ride returns to assigned with the same Driver and Vehicle. Spacing or case of the same designator clears none of those and leaves the Ride accepted. A finished Ride is refused before any write, so the stored facts stay.

**(b) Scope creep.** None.

**(c) Implemented but wrong.** None.
