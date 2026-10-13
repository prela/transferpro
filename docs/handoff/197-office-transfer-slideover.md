# 197 Office Transfers slideover

Out of scope: ride-command behavior, a Transfer archive, landing-time editing, a shared list component, and the correction work-order email (#168).

## Decisions

- Add and Correct share one `USlideover` on the transfers board. The booking form does not sit on the page. Record is `POST /api/transfers`. Correct is `PATCH /api/transfers/:id`. No new route and no migration.
- The row trigger is `Radnje: {guest}` / `Actions: {guest}`. The only item is Correct. A done, no-show, or cancelled Ride has no trigger. Assign, acceptance by phone, vehicle change, reassign, and clear stay the buttons they are.
- An open slideover is `transferpro-transfer-form` in sessionStorage, parsed with Zod, and restored only when `tenantId` matches. Cancel, dismiss, and a successful save delete it. Restore runs in `onMounted`, after hydration. Do not close the slideover because the day field changed.
- Recorded and corrected status, and the no-clients warning, stay on the board. Landing time, Driver, Vehicle, and the ride commands are not fields of this form.
- While a save or add-place is in flight, the slideover exposes `role="status"` with the same label the button shows.

## Code review

Reviewed the uncommitted working tree against `origin/develop` (`git diff origin/develop`). No commits at review time. After this review, the draft is a Zod object scoped to the Tenant, the day field no longer closes the slideover, saving exposes a status, and the unused `transfers.actions` key was removed. `correctActions` stays: the spec requires a dropdown with one item.

## Standards

### Hard

None. `restoreDraft` parses `transferpro-transfer-form` with `transferFormDraftSchema` (`z.object`, `z.uuid()`, `paymentMethodSchema`, and `locationKindSchema`) and restores it only when `tenantId` matches the session. A mismatch or a bad payload deletes the draft (`AGENTS.md`: Zod at every runtime boundary).

### Judgement

**Speculative Generality — `correctActions`.** The menu exists for one command:

```ts
function correctActions(ride: TransferDayRide): DropdownMenuItem[][] {
  return [[{ label: t('transfers.correct'), icon: 'i-lucide-pencil', onSelect: () => openCorrect(ride) }]]
}
```

The template comment says “Correct is the only menu item.” A button that calls `openCorrect` is the whole behavior. `transfers.actions` is added in both locales and never used (`actionsFor` is).

**Repeated switches — `formMode`.** `'edit'` vs add is branched in `applyDraft`, `formTitle`, `@submit.prevent`, and the footer label. `formMode` and `editingTransferId` can disagree; `applyDraft` already derives mode from `transferId === null`.

**Not a hard breach — overlay choice.** `component-selection.md` maps a form to `UModal` and says programmatic overlays use `useOverlay()` instead of `v-model:open`. This `USlideover` plus `v-model:open` matches `ClientList` / `LocationList` / `DriverList` / `VehicleList`. Inputs stay labeled, `size="xl"`, and the footer submit is `form="transfer-form"`, so Enter still submits (`working-rules.md`, i18n and theme). `en` and `hr` both gained the new strings. No ADR-0018 boundary break.

## Spec

### (a) Missing or partial

**Saving is not a status.** "Loading uses a status." Record, correct, and add-place set `:loading` and swap the button label (`Recording` / `Saving` / `Zapisivanje` / `Spremanje`). That label has no `role="status"`. The recorded and corrected alerts do.

### (b) Not asked for

**The board day closes the form.** "Cancel and dismiss close the slideover and do not save." Changing the day field also calls `closeForm()`, which drops the draft and does not save.

**The draft outlives a locale switch.** "A locale switch while the slideover is open keeps it open and keeps the typed values." The same `sessionStorage` draft is written whenever the slideover is open and restored on every mount, so a refresh or a later visit in the tab reopens it. The draft includes the guest name, flight number, note, tabla, and price, and it is not tied to the tenant.

### (c) Implemented but wrong

**A later visit can reopen another tenant's booking.** Same locale-switch line. Restore keys only on `transferpro-transfer-form`. After sign-out and sign-in to another tenant, the slideover opens with the previous booking still filled in.

Add, one shared body, the Correct-only menu (`Radnje` / `Actions` plus the guest), finished rows with no menu, cancel, dismiss, locale values, the recorded status, and the pickup's operational day match the spec. Ride-command selectors were not edited.
