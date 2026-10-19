# 335 Client stale save

Out of scope: version checks on Drivers, Vehicles, Locations, roster, or Tenant settings, and a shared stale-save composable for the Client and Ride forms.

## Decisions

- A Client has its own version on `app.clients`, with `data_changed_at` and `data_changed_by` (migration `0047`), the same shape and checks as `0043` on the Transfer. `data_changed_by` is the member id as text, with no foreign key.
- The Client update locks the row, refuses a version mismatch before the no-op check, and writes with `and version = <opened>` on the same update. A stale no-op is 409 `stale_save`. A fresh no-op writes nothing and does not bump.
- That update runs inside `hideDatabaseError`, because it binds the Client name and the member id.
- `StaleSaveError` lives in `shared/stale-save.ts`. Clients may not import Transfers (ADR-0018). Transfers re-exports it, so its callers are unchanged.
- `loadClients` still returns `Client` for the Transfer reads. `loadClientList` is the list route and returns `version`, `changedAt`, and `changedByName`. The author join also requires `changed_by.tenant_id = c.tenant_id`.
- `PATCH /api/clients/:id` still returns `{ id, name, kind }`. The form reloads the list after a save.
- `ClientList.vue` reuses `StaleSaveAlert` and the `ride.stale*` copy, so no new keys. The notice names the author only once the re-read row's version differs from the opened one. A failed re-read keeps "Netko je u međuvremenu promijenio". Osvježi reopens the form on the current row and version.
- ADR-0046 stays as accepted on `develop`. The owner asked that #335 not edit it and not add a new ADR.
- The local `outbox.rls.test.ts` failure on "refuses an assigned work order that names a vehicle" comes from a local database that applied an earlier draft of `0045`. Its `mail_outbox_shape` lacks the vehicle clause. CI and `transferpro_e2e` migrate fresh.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (689). `pnpm test:e2e` passed: 286 (4.0m), database `transferpro_e2e` only. `pnpm test:rls` passed 326 of 327; the one failure is the local `0045` drift above.

## Code review

Fixed point `origin/develop` (`43ae3a3`), working tree before `360a154`. The Task tool has no `fast` option; both subagents ran on the inherited model. The reports below are that review. After it, the Client update moved into `hideDatabaseError` and a test name was corrected in `360a154`. The ADR-0046 sentence it discussed was removed in `6eba877`.

### Standards

## Hard

No hard violations found.

- **Module boundaries (ADR-0018):** Clients code imports `StaleSaveError` from `shared`, not from transfers.
- **Error body (ADR-0012 / ADR-0046):** `server/api/clients/http.ts` returns status 409 with `data: { code }` and no name.
- **Tenant isolation:** the author join in `loadClientList` checks `tenant_id`, and a cross-tenant author test exists.
- **Migration:** `0047` adds columns with a constant default. The journal `when` is the previous entry plus 1000, per `working-rules.md`.
- **UI rules:** the e2e spec covers both locales and both themes and runs axe. Dates go through `formatInstant`.
- **Tests:** none were weakened. The old assertions were extended with `version`.

## Judgement calls

- **Duplicated Code, `ClientList.vue`.** `staleNotice`, `refreshing`, `noteStale()` and `refreshStale()` copy the same code in `TransferRideDetail.vue`. `staleRow` (`row.version !== openedVersion.value ? row : null`) repeats `staleAuthorHidden`. Two copies of the same flow is reason enough for a `useStaleSave` composable.

- **Duplicated Code, `clients.ts` `correctClient`.** `if (locked.version !== patch.version) throw new StaleSaveError()` copies `refuseStaleVersion`. The compare-and-swap update copies `claimTransferVersion`. Clients may not import transfers, so the copy is defensible. The other option is a small helper in `shared` or core.

- **Hidden database error, against the Transfer precedent.** `claimTransferVersion` wraps its update in `hideDatabaseError`. `correctClient`'s update, which now binds the Client name and the actor id, does not. Drizzle copies bound values into `Error.message`, and `working-rules.md` says that message is not scanned. This gap predates the change, but the change widens it.

- **Middle Man, `transfer-version.ts`.** `export { StaleSaveError }` is only a pass-through. The two callers (`correct.ts` and the transfers `index.ts`) could import from `shared` directly.

- **Data Clumps.**
  - `version`, `data_changed_at` and `data_changed_by`, plus the matching check constraint, now exist word for word on both `transfers` and `clients`.
  - `version`, `changedAt` and `changedByName` travel together in `clientListEntrySchema`, the Transfer day row, and the `StaleSaveAlert` props.
  - A shared change-stamp schema or column helper would remove the repetition.

- **Wider read than needed.** `clientListSchema` now carries every Client's last author. `app/composables/transfer-day-load.ts` parses that list, so the Transfer board receives author names it never shows. A separate list endpoint, or keeping `Client` for the board, would avoid that.

- **ADR-0046 edit.**
  - The edited paragraph now says "this record does not add it" and, in the next sentence, "#335 adds it".
  - AGENTS.md allows updating an ADR when a decision changes. Even so, changing the decision text of an accepted ADR without recorded owner acceptance should be confirmed against the ticket's "Owner decisions" comments, which I did not check.

- **Mysterious Name.**
  - `shared/client.test.ts`: the test "accepts a correction of one field and an empty patch" no longer covers an empty patch, which is now refused.
  - `app/transfer-day-http.ts` (`errorCode`, `httpStatus`) is now imported by the Client list too. Precedent exists, but the transfer-specific name misleads.

### Spec

**(a) Missing or partial**

Nothing required is missing. Each acceptance criterion maps to code and tests:
- **Migration:** `0047` adds the version with a constant default of 0, plus nullable time and member columns.
- **Version on update:** the Zod field is required, and a missing or fractional version gets 400 before the session opens.
- **Atomic write:** the row is locked first, and the update carries the version in its own WHERE clause. A mismatch is checked before the "no change" shortcut, so a stale no-op is refused too.
- **List read:** it returns the version, the time, and the name, joined through `app.tenant_member` by user id and Tenant id.
- **Form:** it sends the opened version and reuses `StaleSaveAlert`, the same notice and Osvježi button as the Transfer form.
- **Version independence:** a test in `transfers.rls.test.ts` covers both directions.
- **Tests:** stale refusal, fresh save, the race, cross-tenant, and the e2e flow in light, dark, and English are all present.

Two small gaps against wording that isn't in the acceptance criteria:
- "A member who has since left is named as a former member": only the HTTP side is tested (the name is null and the time is kept). The UI wording "former member" is not checked for Clients. It goes through the same alert as Transfers.
- "Croatian and English copy, light and dark": English runs only in light. Nothing new needed translating, because the existing `ride.stale*` keys are reused.

**(b) Not asked for (scope creep)**

All three items are small and defensible:
- `StaleSaveError` moved from Transfers' `transfer-version.ts` into `shared/stale-save.ts`, and Transfers now re-exports it. This changes code in the Transfers module. It is justified by ADR-0018, so Clients doesn't import from Transfers.
- ADR-0046 was edited in place with a "#335 adds it…" sentence instead of a new ADR. AGENTS.md allows updating an ADR when a decision changes, but the owner should see this.
- Two CHECK constraints, `clients_version` and `clients_data_change`, were added. The spec didn't ask for them, but they mirror `transfers_version` and `transfers_data_change` exactly. Adding a CHECK scans the whole table but doesn't rewrite it, so "Defaults do not rewrite existing rows" still holds.

**(c) Implemented but looks wrong**

Nothing definite. Points I checked that hold up:
- "Tenant A can never learn who changed Tenant B's record": a planted foreign id gives a null name and an empty JSON body. The UI would then say "former member" for a Tenant B author. That reveals no name, and the Transfer side behaves the same way.
- "The notice names the author only after the re-read row's version differs from the opened one" (precedent from #334): `staleRow` does exactly this. If the re-read fails, the notice falls back to "Netko je u međuvremenu promijenio".
- "The 409 body keeps the ADR-0012 shape": `clientHttpError` returns `data: { code }` with the default message, the same as `transfers/http.ts`. A test confirms the body holds no name or member id.
- One small consistency point: `ClientList.vue` now imports `httpStatus` and `errorCode` from `app/transfer-day-http`. The file name suggests Transfers, but it's app code, so it doesn't break module boundaries.
