# 334 Stale save notice

Out of scope: a separate e2e for reassign and for a vehicle change. Both close through `canChangeAssignment`, which the clear e2e covers.

## Decisions

- The 409 body still carries no name. The notice reads `changedByName` and `changedAt` from the day read. Until that read's `version` differs from the opened snapshot, the alert gets a null name and a null time, so the sentence is "Netko je u međuvremenu promijenio".
- Osvježi copies the current row into the form only when the read landed and the row moved. Assign stays open only while the Ride is unassigned. Reassign and a vehicle change stay open only while `canChangeAssignment` is true. A correction stays open only while `canCorrectTransfer` is true. Clear closes when `canChangeAssignment` is false.
- A correction with no `onStale` handler sets `formErrorKey`. The Ride detail passes a handler, so the notice replaces that error.
- A member who left has a null name and a time, and the sentence uses "Bivši član" / "Former member". The "Vožnja je promijenjena" hint stays.
- No migration.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (684). `pnpm test:e2e` passed: 281 (4.1m), database `transferpro_e2e` only. `pnpm audit --audit-level=high` exited 0.

## Code review

Fixed point `origin/develop` (`7c8db55`), working tree before the QC commit. Both subagents ran with `fast=false`. The reports below are that review. The three spec findings were fixed before `e95f0e6`. QC then required the version check, the guard close, the missing-handler error, and the clear e2e, in `8947253`.

### Standards

**Hard:** none.

No documented-standard breach. Both locales ship `ride.staleBy`, `ride.staleUnknown`, and `ride.staleRefresh` (`docs/agents/working-rules.md`, i18n). The notice uses `formatInstant` and no second formatter (same section). `StaleSaveAlert.vue` is Nuxt UI (`UAlert`, `UButton`), semantic `error` / `neutral` / `text-default`, and `type="button"` (same section). App code imports `staleSaveNotice` from `shared/index.ts` (`AGENTS.md` Security; `docs/adr/0018-module-boundaries.md`). No new log line, audit action, or error-body field: the member name stays on the day read and the screen (`docs/adr/0012-logging.md`; `AGENTS.md` audit rule; working-rules Logging). New names use Transfer, Ride, and Stale save (`GLOSSARY.md`). `e2e/stale-save.spec.ts` is the UI spec (`AGENTS.md`).

**Judgement — Duplicated Code.** The same refusal is copied into four saves, and clear is a fifth:

```ts
if (errorCode(error) === 'stale_save') {
  await props.onStale()
  return
}
```

`RideAssign.vue`, `RideReassign.vue`, `RideVehicle.vue`, and `app/composables/transfer-form.ts` (`options.onStale?.()`). `RideClearDialog.vue` repeats it as `await props.reloadDay(); stale.value = true`.

The same refresh skeleton is in `RideClearDialog.vue` `refreshStale` and `TransferRideDetail.vue` `refreshStale`: guard `refreshing`, await `reloadDay` / `loadDay`, return on `'fail'`, `nextTick`, then clear the flag.

`applyingOpenedRide`, the version `watch` that sets it, and the driver `watch` that bails out are the same shape in `RideAssign.vue` and `RideReassign.vue`.

**Judgement — Mysterious Name.** `applyingOpenedRide` means "this driver write came from Osvježi, so skip roster pre-fill."

**Judgement — Speculative Generality.** `TransferForm.vue` exposed `applyRide: openCorrect` beside `openCorrect`.

### Spec

### (a) Missing or partial

None. Correction, assign, reassign, vehicle change, and clear all show `StaleSaveAlert`: "Promijenio {ime} u {vrijeme}" through `formatInstant` in the tenant zone, "Osvježi", `role="alert"`, the unknown and former-member sentences, and the existing "Vožnja je promijenjena" hint. English copy is present. Focus moves on mount. The e2e is two contexts on one Transfer, light and dark, desktop and phone, axe, and one English smoke.

### (b) Scope creep

None.

### (c) Implemented but wrong

"Osvježi reloads the Ride detail read and puts the current values and version into the form." Both detail call sites passed `async () => { await loadDay() }`, so `'fail'` and `'stale'` never arrived. `refreshStale` returned only on `'fail'`, then copied `props.ride` into the snapshot and the correction form and cleared the notice and the hint. A superseded read has not applied its body yet, so that copy can be the pre-refresh row and the next save is stale again. Clear's `reloadDay` did return the outcome and kept the notice on `'fail'`, but it still committed the version on `'stale'`.

"On 409 `stale_save` … shows \"Promijenio {ime} u {vrijeme}\"." `noteStale` always raised the alert after that discarded result. The text was bound to the row already on screen, so a failed read showed the opened author. On a version-0 row that is "Netko je u međuvremenu promijenio".

Same Osvježi sentence. `RideReassign` and `RideVehicle` render only while `formRide.driverId` or `formRide.vehicleId` is set, and `formRide` is the snapshot. Osvježi replaces the snapshot and clears the notice. If the winning save was a clear, both ids are null, the form unmounts, and `command` stays `reassign` or `vehicle`, so the facts and the action bar stay hidden.
