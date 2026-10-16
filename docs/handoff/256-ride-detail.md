# 256 One Ride detail

Out of scope: Home and search do not open this detail yet, and no server route, read, or write changed.

## Decisions

- The detail closes only after a clean success (a sent work order, or a command with no work order). `no_email` and `failed` leave it open, with the warning inside it, and focus stays on the detail. Cancelling assign or accept-by-phone returns to the facts and focuses the detail. It does not close it.
- After the user closes the detail, a warning they have not dismissed stays on the day list. Closing the panel must not drop it.
- Desktop command buttons are 28 px (`sm` and `h-7`). Inputs stay 16 px. Nuxt UI size `sm` is 14 px and 12 px from the `md` breakpoint, so `commandInputClass` forces the field text back to 16 px. The phone, and the add-Transfer slideover, stay `xl`. The phone Driver list stays a large target.
- Opening a Ride pushes a history entry. `history.replaceState` runs only when the Ride is cleared, so phone Back restores a list entry that does not still carry `?ride=`. Forward returns to the Ride.
- `rideFormStamp` includes `clientId`. A refresh that changes only the Client shows "Vožnja je promijenjena" and does not replace the open form.
- Done stays a confirmation modal. It cannot be undone, so ADR-0038 keeps a confirmation, and this screen uses the same modal the row already had. The Ride-detail paragraph names cancel, no-show, unassign, and the overlap modal; the review below records that done is not on that list.
- No migration.
- e2e, after `pnpm exec nuxi build`: `PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" E2E_PORT=4173 pnpm test:e2e` — 185 passed. Port 3000 was already in use, so the suite did not use the default port and did not attach to that process. `pnpm lint`, `pnpm typecheck`, and `pnpm test` (526) passed.

Changed specs, rewritten rather than deleted:

- `e2e/ride-detail.spec.ts` — new `@phone` spec: beside panel and phone full screen, `?ride=`, Back then Forward then Back, commands, the stale-form sentence, axe in light and dark, English once on light.
- `e2e/ride-assign.spec.ts` — cancel returns focus to the detail. The three focus-next cases give the Driver an address so the work order is sent and the detail closes. The archived-vehicle case closes the detail before the next assign.
- `e2e/day-list-accept-by-phone.spec.ts` — cancel of accept-by-phone leaves the detail open and focused.
- `e2e/correct-transfer.spec.ts` — the overlap confirmation still passes; a Driver with no email leaves the warning in the detail.
- `e2e/ride-change.spec.ts`, `e2e/ride-occupation.spec.ts`, `e2e/work-order-assign.spec.ts`, `e2e/work-order-change.spec.ts` — after a no-email result the detail stays open, so the spec closes it before the next row click. The overlay at 1280 px would otherwise cover that click.
- `e2e/work-order-cancel.spec.ts` — a quiet cancel is `role="status"` and does not mention a work order.

## Code review

Fixed point `origin/develop`. The reports below are the review before `60ee1a5` (16 px inputs, and `clientId` on the stamp).

## Standards

**Hard:**

Desktop command and correction fields are 14px, and 12px from the `md` breakpoint. `commandControlSize(false)` is `'sm'` (`app/ride-detail.ts`). `RideAssign.vue`, `RideReassign.vue`, `RideVehicle.vue`, and `RideLanding.vue` set that on `UFormField`, which the input inherits. `TransferForm.vue` passes `control-size="sm"` into `TransferFormFields` for a desktop correction. Nuxt UI Input theme: size `sm` is `text-sm/4`, and with default `fixed: false` the compound class is `md:text-xs`. Size `xl` is the one that stays `text-base`. `docs/agents/working-rules.md` (i18n and theme): “Inputs are labeled, 16px, and submit with Enter.” `docs/adr/0038-office-and-driver-ui.md` (Devices and density): “Inputs stay at 16 px on every layout.” The 28px row control (`h-7`) is the button size in that same section.

Done still opens a modal. `TransferRideCommands.vue`: “Confirmations stay modals: cancel, no-show, unassign, done…”, and the detail’s `@done` calls `openMarkDone`. ADR-0038 (Ride detail): “A modal is kept only for a confirmation: cancel, no-show, unassign, and the overlap confirmation of ADR-0029.” Done is one of the commands that section puts in the detail. A confirmation is still required, because done cannot be undone; that confirmation is not on the modal list.

**Judgement:**

- **Duplicated Code.** `TransferDay.vue` mounts `TransferRideDetail` twice, in the beside `UDashboardPanel` and in the `USlideover`, with the same props and events.
- **Duplicated Code.** `RideAssign.vue`, `RideCancelDialog.vue`, and `RideClearDialog.vue` share this branch: `if (notice === undefined) { toast.add({ title, color: 'success', role: 'status' }) } else { present(...) }`.
- **Duplicated Code.** The work-order `UAlert` (outcome color, `actionTitle`, close, `workOrderNotice` description) is copied for `pageNotices` in `TransferDay.vue` and `notices` in `TransferRideDetail.vue`.
- **Repeated Switches.** `TransferRideDetail.vue` cascades `primary`, `runPrimary`, and `primaryLabel` on `'assign' | 'accept' | 'done'`.

## Spec

## (a)

"Every e2e spec that pinned the old behaviour is rewritten to assert the new equivalent, never deleted without a replacement; the handoff flags each changed spec and why." The specs are rewritten in place (`correct-transfer`, `day-list-accept-by-phone`, `ride-assign`, `ride-change`, `ride-occupation`, `work-order-assign`, `work-order-cancel`, `work-order-change`), and `e2e/ride-detail.spec.ts` only says so in a comment. Nothing in the diff flags each one and why. There is no `docs/handoff/256-*.md`.

The panel (~420 px, beside at ≥1440, overlay below), phone full screen with "Više" replacing the bottom nav, `?ride=`, phone Back (filters, scroll, and goForward still has `?ride=`), the commands, the ADR-0029 overlap modal, driver-named work-order copy, both locales, and the `@phone` light/dark axe spec are in the diff. No server route or migration is.

## (b)

"no email" and "send failed" stay in the Ride detail until the user closes them. After the detail is closed, the same notices also render on the Transfers list (`pageNotices` in `TransferDay.vue`). That list surface was not asked for.

## (c)

"When the open Ride changed during a refresh while one of its forms is being edited, the form is not replaced and shows 'Vožnja je promijenjena'." The open form keeps a snapshot, and the correction form reloads only when `rideId` changes, so typed fields stay. `rideFormStamp` omits `clientId`, which the correction form edits. A refresh that changes only the Client does not show "Vožnja je promijenjena".
