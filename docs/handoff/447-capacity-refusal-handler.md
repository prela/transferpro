# 447 One handler for capacity refusals

Out of scope: the refusal dialog copy, which codes can be confirmed, and the server capacity checks.

## Decisions

- `useCapacityRefusal` owns the catch for assign, reassign, vehicle change, hand-off, and a Transfer correction. `fully_booked` opens Popunjeno and cannot be confirmed. `ride_overlap` and `ride_unavailable` still open the dialog the caller confirms. `stale_save` reloads when the caller passed `onStale`, and otherwise falls through to that caller's own failure.
- Hand-off still starts the closed dialog on `unavailable` (`initialReason`). The other four start on `overlap`. A 409 overwrites that before the dialog opens. The Spec finding below is the draft review, from before that argument was restored.
- The stale-save branch stays in this handler because it was the next branch of the same copied catch. The name stays `useCapacityRefusal`.
- The new tests are `app/composables/capacity-refusal.test.ts`. `vitest.config.ts` includes `app/**/*.test.ts` so `pnpm test` runs them. No existing test was edited.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (940) passed. `pnpm test:e2e` passed (331). No migration.

## Code review

## Standards

**Hard violations:** none.

Imports stay on `../../shared` (`AGENTS.md` module entrypoints; ADR-0018). `capacityRefusalReason` is the shared contract the browser already used; nothing imports `server/modules/capacity` (ADR-0034 allow-list; `CHARTER.md`: `app/` does not import `server/`). No new copy, so `docs/agents/working-rules.md` (both locales, light and dark) does not apply. No screen or flow change, so `AGENTS.md` (“a UI change adds or extends a spec under `e2e/`”) does not apply. The old five-site catch is one function; no test is removed or weakened (`AGENTS.md`). `vitest.config.ts` only adds `app/**/*.test.ts` so that test runs under `pnpm test`. Glossary terms (Ride, Transfer, Popunjeno) match `GLOSSARY.md`.

**Judgement call — Mysterious Name.** `app/composables/capacity-refusal.ts`. ADR-0034 lists `stale_save` with the existing refusals, then `fully_booked`, `ride_overlap`, and `ride_unavailable`. The function name says capacity only, but it also reloads a stale save and sends every other error to the caller:

```22:35:app/composables/capacity-refusal.ts
async function handleCapacityRefusal(error: unknown, onFailure: () => void): Promise<void> {
  const code = errorCode(error)
  const reason = capacityRefusalReason(code)
  // ...
  if (code === 'stale_save' && options.onStale) {
    await options.onStale()
    return
  }
  onFailure()
}
```

`useTransferForm` is a Transfer correction, not only a Ride command. The file comment states the real job; the name does not.

## Spec

**(a) Missing or partial**
None. "One shared handler (composable) owns the catch; the five callers use it." `useCapacityRefusal` maps the code, opens or closes the dialog, and reloads on `stale_save`. `RideAssign.vue`, `RideHandOff.vue`, `RideReassign.vue`, `RideVehicle.vue`, and `app/composables/transfer-form.ts` call it. No migration.

**(b) Scope creep**
None in product behaviour. `vitest.config.ts` now includes `app/**/*.test.ts`, and `capacity-refusal.test.ts` is new. "Existing unit and e2e tests pass unchanged; no test is weakened." No existing test file is edited.

**(c) Implemented, but wrong**
"Behaviour is unchanged." Hand-off used to initialise `refusalReason` to `'unavailable'`. The shared composable always starts it at `'overlap'`. After a 409, the handler still sets `fullyBooked`, `overlap`, or `unavailable` before opening, and `RideOverlapDialog` still hides confirm for `fullyBooked` and keeps it for overlap and unavailability. The initial value is the only difference, and the dialog stays closed until a refusal overwrites it. `stale_save` still reloads when a caller passed `onStale`, and still falls through to the form error when it did not.
