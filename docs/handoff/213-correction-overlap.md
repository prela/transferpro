# 213 Judge a true overlap when a Transfer correction moves the occupied window

Out of scope: judging a landing record or clear, a transfer-duration change, an audit field for a confirmed overlap, naming the other Ride, and deduplicating the 409 dialogs.

## Decisions

- Judge only an assigned or accepted Ride that already has a Driver and a Vehicle, and only when the occupied window moves. A pickup change moves the start. A flight-number change that clears a stored landing can move the end. A place change, a guest change, or spacing or case of the same designator does not. An unassigned Ride is not judged. An earlier confirmation is not remembered.
- `409` `ride_overlap` writes nothing unless the body has `confirm: true`. The success body adds `relocationWarnings`, the same shape as assign. It is empty when the correction was not judged or the gap equals the setting.
- Refusal order stays: parse, office role, missing Transfer, finished Ride, Client or archived Location, a save that changes nothing, then overlap. Return to assigned and the two audit rows follow, in the same transaction. The changed work order is sent after commit. A 409 sends nothing and appends nothing.
- `parseCorrectTransfer` in `shared/transfer.ts` is the correction body: the record fields plus optional `confirm`. `parseCreateTransfer` still refuses `confirm`.
- The slideover reuses `RideOverlapDialog` and `ride.tightGap`. No new locale keys. ADR-0029 already includes the correction paragraph. No migration.

## Code review

Reviewed `git diff origin/develop...HEAD` at `db2bd05`.

## Standards

**Hard**

`server/modules/transfers/infrastructure/correct.ts` (`parseCorrect`). `AGENTS.md` (Security): “Zod at every runtime boundary (env, request bodies, query params, imported bookings).” `confirm` is a request field checked with `typeof`, then stripped, then the rest goes through `parseCreateTransfer`. Assign, a vehicle change, and a reassignment declare `confirm: z.boolean().optional()` on the shared command (`shared/ride-assignment.ts`). ADR-0018: the module contract lives in `shared/`. `createTransferSchema` is a strict object, so `confirm` cannot sit on the record body (ADR-0029: the record route does not accept it). It still wants its own Zod object in `shared`.

```
  const confirm = record.data.confirm
  if (confirm !== undefined && typeof confirm !== 'boolean')
    throw new TransferInputError()
  const { confirm: _confirm, ...booking } = record.data
```

**Judgement**

**Duplicated Code** — `e2e/correct-transfer.spec.ts`. The Croatian overlap test and the English/dark test each seed a driver, two vehicles, a client, two locations, and a local `record()`. Working rules require both locales and both themes, so both tests stay; the setup is the copy.

**Duplicated Code** — `server/api/transfers.rls.test.ts`. `driverInput` / `vehicleInput` are added in this diff, but the first new test still inlines the same licence and plate objects. The same `select pickup_at from app.transfers` runs in the driver, archived, and again tests, next to `storedTransfer`, which already reads that row and omits `pickup_at`.

**Mysterious Name** — `correct.ts`: `const judge = await occupiedWindowMoves(...)`. `judge` holds `{ driverId, vehicleId } | null`, the resources to check, not a verdict.

Suppressed: spread across HTTP, shared schema, UI, and e2e is the module split. `landingAt: z.unknown()` matches `ride-schedule.ts`. “Place” in the new comment follows ADR-0029.

## Spec

### (a) Missing or partial

The vehicle-only case is only partly what Testing Decisions asks for. “a pickup moved into a Driver overlap returns 409, with the booking, state, audit, and mail unchanged” and “the same for a Vehicle-only overlap.” The vehicle test checks 409 `ride_overlap`, Ride state, and correction audits. It does not check that the stored booking is unchanged, or that the mailer sent nothing. The Driver case checks both.

The other named cases are present: confirm plus accepted-to-assigned and both audit rows, guest-only, place-only, flight designator that clears a landing, spacing or case, unassigned, `transfer_closed` before `ride_overlap`, archived Location before overlap, no-op, tight gap, gap equal to the setting, done / no-show / cancelled, in-progress, a later move asked again, and the correct-transfer end-to-end dialog (cancel leaves the slideover and the row, confirm closes it and updates the row, Croatian and English dark). A driver is still 403 in the existing correction test.

### (b) Scope creep

None. `confirm` on `POST /api/transfers` stays a 400 because the record body is already a strict object (“The record route does not change”). The board-warnings test passes `confirm: true` only so that setup correction can still save.

### (c) Implemented but wrong

None found against the issue or the ADR-0029 correction paragraph.

Judgement runs only for an assigned or accepted Ride with a Driver and a Vehicle, and only when the pickup moves the start or a designator change that clears a stored landing moves the end. The existing `checkRideSchedule` runs after the booking write, inside the same transaction. Refusal order matches the numbered list: parse, office role, lock, finished Ride, Client or archived Location, no-op, then overlap, then return to assigned, then `transfer.corrected` and `ride.returned_to_assigned`. A 409 writes nothing and sends no work order. `relocationWarnings` is empty when the window was not judged or the gap equals the setting. The slideover keeps its values, opens `RideOverlapDialog`, and on success uses `ride.tightGap` with no other Ride id and no guest name. No migration and no ADR edit.

After this review: `confirm` is parsed by `parseCorrectTransfer` in `shared/transfer.ts`. The vehicle-only case checks the stored booking, the pickup, and that the fake mailer sent nothing. `judge` is renamed `occupation`.
