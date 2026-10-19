# 353 Capacity module

Out of scope: unavailability windows, `fully_booked`, the Partner handoff, the `partners` entry in the capacity allow-list (ADR-0034 names it; the ticket and the codebase have no `partners` module yet), and any behaviour change.

## Decisions

- The contract is `shared/capacity.ts` (moved from `shared/ride-schedule.ts`). It also holds `overlappingRideIds`, so the board's overlap warning in `shared/board-warnings.ts` comes from capacity. `deriveBoardWarnings` still takes `others`, so its tests are unchanged.
- The occupation port has two questions. `ridesOf` is the command question: the Driver or Vehicle of one Ride, everything the old `readOccupyingRides` read. `ridesDuring` is the range question for the board: id lists or `'tenant'`, a range, and an optional `leaveOut`. Partner ids and `'tenant'` are typed but not used yet.
- Transfers implements the port in `transfers/infrastructure/occupation-port.ts`, not in `ride-occupation.ts`. `vi.mock('./ride-occupation', { spy: true })` only sees calls that cross a module, so the #351 spy on `readOccupyingRides` keeps working unchanged.
- Transfers calls `judgeRideCapacity` for assign, a Vehicle change, a reassignment, and a judged correction, through `checkRideCapacity` in `capacity-check.ts`. Capacity returns the verdict. Transfers throws `RideOverlapError`, which capacity exports and transfers re-exports for the routes. The correction's "does the window move" rule is `correctionMovesWindow`. The board's neighbour read is `readBoardOccupation`.
- `lockTenantCapacity` moved verbatim to `capacity/infrastructure/lock.ts`. The callers and their order are unchanged.
- The transfer duration and relocation gap come from `loadTenantSettings` (tenancy) through `tenantCapacityMinutes`.
- `readBoardOccupation` checks the office role itself (AGENTS.md, Security). `judgeRideCapacity` is a command step and follows the transfers convention ("the caller has already required a dispatcher or an admin"). Only transfers may import capacity, so the lint rule holds that line.
- `checkRideCapacity` reads the Ride's times before the Tenant settings. The old code read settings first. The only change: when both are missing, the error is `RideNotFoundError` instead of `TenantSettingsMissingError`.
- The fake port is `capacity/testing.ts`, the same pattern as `tenancy/testing.ts`. The capacity boundary rule stops anything outside capacity from importing it.
- Lint: the `capacity-boundary-import` rule in `eslint.config.mjs` and a ban on Drizzle, Nuxt, Better Auth, h3, and the queue in capacity domain and application, with tests in `server/core/import-gate.test.ts`. `#app` and `#imports` are listed under `paths`, because a gitignore-style pattern reads a leading `#` as a comment.
- Coverage is unmeasured. No coverage provider is installed.

## Test edits flagged

- `assign.test.ts` and `ride-change.test.ts`: only the `RideOverlapError` import moved to `../../capacity`.
- `shared/ride-schedule.test.ts` moved to `shared/capacity.test.ts`. Only the import changed.
- No test name or assertion changed or was removed.

## Code review (since df13fc8)

- Spec: all criteria met. No behaviour drift in the SQL, the lock, the error codes, or the board range. Noted: the read-order change above, and that capacity-to-capacity imports are not checked between tiers by the new rule.
- Standards: fixed the two `toInstant` helpers with different return types (the `Date` one is now `toInstantDate`) and moved the fake port to `testing.ts`. Left as judgement calls: `idsOf` in both board files, `RideTimes` repeated inline, and the thin `capacityPorts` factory.
