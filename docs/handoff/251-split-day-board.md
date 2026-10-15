# 251 Split the day board

Out of scope: the new Transfers layout, the Ride detail panel, filters, the occupation strip, and live refresh.

## Decisions

- `pnpm exec nuxi build`, then `E2E_PORT=3010 pnpm test:e2e`: 162 passed. Port 3000 was already taken, so the suite used 3010 and did not attach to that process. `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (501 tests). No migration. No e2e spec was edited.
- The day board is `TransferDay.vue`. It only composes the toolbar, the status alerts, the table, the command forms, and the Transfer form.
- The Ride row is `TransferRideRow.vue`, mounted once per custom column. The `<tr>` stays inside `UTable`, so row and cell roles stay as they are. The guest column stays an `accessorKey`. Do not replace the table body.
- Ride command forms are `TransferRideCommands.vue` plus the existing assign, vehicle, reassign, and landing components, and `RideClearDialog`, `RideAcceptByPhoneDialog`, `RideMarkDoneDialog`, `RideMarkNoShowDialog`, and `RideCancelDialog`. Button ids live in `app/transfer-ride-buttons.ts`. A closed dialog focuses that button.
- A day change still only closes assign and accept-by-phone. The booking slideover stays open.
- The Transfer form is `TransferForm.vue` with `useTransferForm`. The draft key stays `transferpro-transfer-form`.
- Day and catalog reads are `useTransferDayLoad`. A newer load ticket wins.
- Driver names go through `driverDisplayName` in `app/transfer-day-labels.ts`.
- `canCallOff` keeps its name. It still means the Ride can be cancelled.

## Code review

Fixed point `origin/develop` (`74c796f`). Commits `d210559` and `dec5b33`. The reports below are the review of that diff.

## Standards

**Hard:** none. New files import types and schemas from `../../shared` only (`AGENTS.md` Security; ADR-0018: reach a module through its public `index.ts`). Copy stays on `t()`, instants on `formatInstant`, controls on Nuxt UI with Lucide icons, `size="xl"`, and `role="alert"` / `role="status"` (`docs/agents/working-rules.md` “i18n and theme”; ADR-0016). No new locale keys. Glossary nouns (Transfer, Ride, Client, Guest) are used in the new names.

**Judgement**

- **Duplicated Code.** `RideAcceptByPhoneDialog.vue`, `RideMarkDoneDialog.vue`, and `RideMarkNoShowDialog.vue` share one shape: target ref `{ rideId, guestName }`, pending flag, 409/401 key map, POST, audit bump, `loadDay`, focus the button. Same footer in each. Extract one confirm dialog. `RideCancelDialog.vue` and `RideClearDialog.vue` are the same shape plus a toast.
- **Repeated Switches.** `TransferRideTable.vue` mounts `TransferRideRow` once per column (`cell="pickup"`, `cell="landing"`, …) with the same catalog props, and `TransferRideRow.vue` switches again: `v-if="cell === 'pickup'"` … `v-else-if="cell === 'actions'"`. One slot map, or one row component, would hold that.
- **Middle Man.** `TransferDay.vue` only forwards: `@assign="ride => commands?.openAssign(ride)"` (and the same for landing, cancel, done, no-show, vehicle, reassign, clear). `TransferRideCommands.vue` then only delegates: `openClear: (ride) => clearDialog.value?.open(ride)`. `canFinish`, `canNoShow`, and `canCallOff` in `app/transfer-ride-guards.ts` each return one shared predicate.
- **Mysterious Name.** `canCallOff` does not say cancel. Quote: `export function canCallOff(ride: TransferDayRide): boolean { return canCancelRide(ride.state) }`. Glossary term is Cancelled (`GLOSSARY.md`); `AGENTS.md` says use those terms in code. Rename toward cancel.
- **Data Clumps.** `{ rideId: string, guestName: string }` is the open-dialog payload in every command dialog and in `TransferRideCommands.vue` (`assigning`, `recordingLanding`, `changingVehicle`, `reassigning`).
- **Shotgun Surgery.** A new row command now touches the row button, the table emit, the day forwarder, the commands expose, and a dialog.
- **`AGENTS.md` Workflow** (“A UI change adds or extends a spec under `e2e/`”): this diff does not. Judgement only: the commits are a split of the existing board, so existing specs may already cover it.

## Spec

### (a) Missing or partial

**Ride row is not a row.** Spec: “Split the Transfers day-board component … into the parts the new layout will need: the Ride row, the Ride command forms, the Transfer form, the day toolbar, and the data loading.”

`TransferRideRow` takes a `cell` prop and renders one column. `TransferRideTable` mounts it once per column. The guest column is still a `UTable` `accessorKey` (`guestName`), not part of that component. The `<tr>` stays inside `UTable`. Toolbar (`TransferDayToolbar`), command forms (dialog components plus `TransferRideCommands`), transfer form (`TransferForm` / `useTransferForm`), and data loading (`useTransferDayLoad`) are present. `TransferDay.vue` is 177 lines of composition.

### (b) Scope creep

None. No ride detail panel, filters, or occupation strip. No migration. The diff does not edit spec files. `pnpm lint`, `pnpm typecheck`, and `pnpm test` were not run.

### (c) Implemented, but wrong

**The “ride row” is a cell switch.** Spec: “the Ride row” and “Behaviour, markup that tests rely on, and labels do not change.”

`dec5b33` renders each cell by instantiating `TransferRideRow` with `cell="pickup"` … `cell="actions"`. That is not one ride row for the later layout. The cell templates themselves match the old board: same roots (`time`, `span`, action `div`, text for start/end/driver/state), same `t(...)` aria-labels, same button ids (`assign-ride-`, `accept-by-phone-`, `mark-done-`, `mark-no-show-`, `cancel-ride-`, `change-vehicle-`, `reassign-ride-`, `clear-ride-`). Guest text is unchanged because it never moved. I do not see an extra wrapper, dropped label, or renamed button that would change row/cell accessible names. E2e was not run.
