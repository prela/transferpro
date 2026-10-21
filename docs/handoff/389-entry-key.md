# 389 Server test helpers send the Transfer entry key

Out of scope: e2e specs stay on #390, and making the key required stays on #391. No migration and no production code.

## Decisions

- `createBody` sends a fresh `externalId` and then spreads `correctionBody`, so an override reuses one id on a repeat. `correctionBody` itself stays without a key.
- `booking()` stays without a key, because a correction spreads it. The key is added only on the create call in `transfer()`.
- The create that proves a body without the key still records still posts `correctionBody`.
- `recordTransfer` unit calls pass a fresh id. The repeat test keeps the id it already passed.
- Raw inserts that already send `gen_random_uuid()` were left alone.

## Code review

Fixed point `origin/develop`. The reports below are the review of `0a4b6cd`.

## Standards

**Hard violations:** none.

`AGENTS.md` (no deep imports; never weaken or remove a test; Conventional Commits): the commit is `test(transfers): send the entry key from server create helpers`. No import lines change. No assertion is dropped or softened. `docs/adr/0018-module-boundaries.md`: no new cross-module import. `docs/adr/0035-idempotent-entry-and-reactions-to-a-change.md`: correction bodies stay keyless; creates send `externalId`. The one create that still uses `correctionBody` in `server/api/transfers.rls.test.ts` omits the key on purpose (`// This create omits the key on purpose: the server still assigns one.`), which matches the server-assigns path rather than an insert that forgets `external_id`. `docs/agents/working-rules.md`: no tenant, audit, or log path. `GLOSSARY.md`: Transfer stays the glossary term.

**Judgement — Duplicated Code.** The same fresh-id field is copied into each create helper:

```text
externalId: crypto.randomUUID(),
```

It is inlined in `board-warnings.rls.test.ts`, `failed-mail.rls.test.ts`, `office-home.rls.test.ts`, `rides/upcoming.rls.test.ts`, `transfers-search.rls.test.ts`, and again as raw POST bodies in `transfers.rls.test.ts` after `createBody` was added in that file. The same comment is copied in `rides.rls.test.ts`, `transfers-export.rls.test.ts`, and `outbox.rls.test.ts`:

```text
// Fresh entry key. The create stays idempotent once the key is required.
externalId: crypto.randomUUID(),
```

`capacity-lock.rls.test.ts` and `unavailability.rls.test.ts` share the spread and the comment:

```text
// The key is added here, not on booking(), because a correction spreads booking() and refuses the key.
return createTransfer(dispatcher, { externalId: crypto.randomUUID(), ...this.booking(pickupAt) })
```

`transfers.test.ts` passes a positional `crypto.randomUUID()` at each `recordTransfer` call. ADR-0035 (“Every test, fixture, and seed that inserts a Transfer has to supply an `external_id`”) requires the value on each insert, so the spread across files is not Shotgun Surgery. A single helper per file is still open.

**Suppressed.** Primitive Obsession on the uuid string: ADR-0035 types `external_id` as text. Middle Man on `createBody`: ADR-0035 gives the correction body no key, so a separate create helper is the rule. “Entry key” in the new comments follows that ADR’s “entry” wording; the field stays `externalId`.

## Spec

**(a) Missing or partial:** none.

"Every server test helper that builds a Transfer create body (unit tests and the RLS suite) adds a fresh random externalId" is met. Route helpers (`createBody`, `transferBody`, inline `createTransfer` bodies) and `recordTransfer` calls in `transfers.test.ts` send `crypto.randomUUID()`. Raw inserts in `transfer.rls.test.ts` and `seedRide` already send `gen_random_uuid()` and were left alone.

"A test that asserts a repeat reuses one id on purpose" holds: the once, two-tenant, held-insert, and driver-lookup cases pass one `externalId`. "The test named along the lines of 'a body without the key still records' must keep omitting the key" still posts `correctionBody` with no key. "Corrections refuse externalId, so correction bodies must not gain one": `correctionBody` and `booking()` stay keyless; the key is added only on the create call. "No production code changes" and "same assertions and test names": the diff is twelve test files, and no `it`/`expect` line changed. The commit reports "Fixture only, no assertion changed."

**(b) Scope creep:** none. Comments and the new `createBody` wrapper only place the key. No production files, assertion edits, or new behaviour.

**(c) Implemented but wrong:** none. `createBody` sets a random id, then spreads overrides, so a passed `externalId` replaces it. Repeat posts still share one id.
