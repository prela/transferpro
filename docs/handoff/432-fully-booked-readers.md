# 432 Fully booked readers

Out of scope: `partnerCovered` stays separate from the Driver and Vehicle check. Renaming `RideOverlapDialog`, the `blocked` flag, and the reason switch stay out.

## Decisions

- The fleet reads stay serial. One session client cannot run them together.
- One `taken` check reads `driverId` or `vehicleId`. A Partner stays free from unavailability alone.
- The two callers still map the shared read onto `windowIsFullyBooked`. Each Ride on the board has its own span and its own left-out Ride.
- After the review, the chosen-pair comment says the caller skips the read when that pair is already free, and `FleetWindow` is `FleetSpanRead`.
- The #414 QC comment on this ticket: `overlapOpen`, `confirmReason`, and `CapacityDialogReason` are `refusalOpen`, `refusalReason`, and `CapacityRefusalReason`. `RideHandOff` used `confirmOpen` for the same dialog, so that flag is `refusalOpen` too. `capacityDialogReason` still maps the 409 code. No behaviour change.
- No migration. `pnpm test:rls` was not required.
- The reports below are verbatim, before the comment follow-up and the refusal rename.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (933) passed. `pnpm test:e2e` passed (331, 5.4m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

Reviewed `chore/432-fully-booked-readers` against `origin/develop`. The reports below are verbatim.

## Standards

No hard violations. ADR-0034, ADR-0018, and AGENTS.md hold: ports only, no cross-module deep import, and the board read still checks the role itself. Glossary terms (Driver, Vehicle, Partner, Ride, free, fully booked) are used. Sharing `taken` for Driver and Vehicle, and leaving `partnerCovered` separate, matches GLOSSARY.md **Free**.

**Judgement — comment no longer matches the read** (`server/modules/capacity/application/fully-booked.ts`). Comments in this module state when a read happens (`judge-ride.ts`: "the fleet is not read"). This block still says:

> A chosen pair that is free makes the answer false before the rest of the fleet is read.

The body always `await readFleetWindow` first, then calls `windowIsFullyBooked`. The skip sits in `judgeRideCapacity`, before this function.

**Judgement — Duplicated Code / Data Clump** (same file). Both callers remap the same bundle:

```ts
activeDriverIds: fleetWindow.driverIds,
activeVehicleIds: fleetWindow.vehicleIds,
activePartnerIds: fleetWindow.partnerIds,
occupying: fleetWindow.occupying,
windows: fleetWindow.windows,
```

`FleetWindow` and `FullyBookedFacts` are that clump with the ids renamed.

**Judgement — Mysterious Name** (`FleetWindow`). It holds active ids, occupying Rides, and unavailability windows. GLOSSARY.md **Fully booked** and **Unavailability window** already use "window" for the Ride's span and for a Nedostupnost row. The field `windows` is the latter.

## Spec

The diff matches issue #432. Nothing is missing, partial, extra, or implemented incorrectly.

**(a) Missing or partial.** None.

- "One shared read supplies the fleet, the occupation, and the windows to both callers." `readFleetWindow` is the only fleet, occupation, and window read, and both `readFullyBooked` and `readBoardFullyBooked` use it. The board still reads once for the whole list.
- "One check decides whether a Driver or a Vehicle is taken." `driverTaken` and `vehicleTaken` are replaced by `taken`, which selects `driverId` or `vehicleId`.
- "The fleet reads stay serial." `driverIds`, `vehicleIds`, and `partnerIds` are still awaited one after another.
- "Fully booked, the board warning, and 409 `fully_booked` keep today's behaviour." The empty-fleet result, the skipped occupation when no pair is possible, the board's omitted `leaveOut`, and each Ride left out only at judgement time are unchanged. `judgeRideCapacity` and `judgePartnerCapacity` still call `readFullyBooked`.
- "No migration." The diff is the two fully-booked modules and their tests.

**(b) Scope creep.** None. `partnerCovered` and `freePartnerIds` in `domain/unavailability.ts` are untouched. The new tests only pin the shared board read, the skipped occupation, and the Driver-versus-Vehicle check.

**(c) Implemented but wrong.** None. The shared read keeps the previous query bounds: occupation starts one transfer duration earlier, windows use the occupied span, and a command still passes `leaveOut` while the board does not.
