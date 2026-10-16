# 259 Transfer form in the panel

Out of scope: no new server route, and no migration. The Client reference is shown and kept in the browser draft only.

## Decisions

- The form opens in the Ride panel: beside at ≥1440 px, overlay below that, phone full screen. One instance is mounted, in whichever panel is showing.
- Basic fields stay visible. Više (flight, airport mark, tabla, luggage, child seats, note) starts collapsed and opens on a correction when one of those has a value. Airport mark is a checkbox, not inferred from the flight. Enter submits.
- Client and Location are searchable selects. "+ Dodaj ‘…’" posts through the existing Client and Location writes and selects the new record. Location still asks for kind, because `POST /api/locations` requires it. A picked address suggestion sends `place`; typed text sends null.
- After save the panel shows the new Ride, with Dodijeli as its action, and a "Zabilježeno." toast.
- The unfinished new Transfer is `localStorage` under `transferpro-transfer-draft:${userId}:${tenantId}`. It expires after 24 hours, restores with "Vraćen nedovršeni unos" and "Odbaci", and is removed on save, Odbaci, and sign-out. Closing or Odustani keeps it. A correction is not a draft. The old `sessionStorage` key `transferpro-transfer-form` is removed on restore. The draft is never sent to the server.
- The Client reference has no column (`app.transfers`, `createTransferSchema`). The field is in the form and the draft. `bookingBody()` does not send it, so a typed reference is dropped on save. Open question for the owner: store it, or drop the field until a migration is allowed.
- Menus inside the slideover use `z-[70]`. The panel is `z-[60]`, and a portaled menu with no z-index sits under it, so a click landed on the field behind the option.
- No migration.

Changed specs, rewritten rather than deleted:

- `e2e/transfers.spec.ts` — the form is the panel (a dialog at the desktop width). Client, start, and end are buttons with a listbox, not comboboxes. Više hides the flight and the tabla until it is opened. Quick add replaced the old "add a place" buttons. The Client label is Naručitelj. Save leaves the Ride detail open with Dodijeli, instead of closing the dialog. The same-place and too-early messages are in the summary and beside the field, so those assertions take the first match.
- `e2e/transfer-form.spec.ts` — new. Reload restores the draft, Odbaci removes it, another user on the same browser never sees it, quick add returns the new Client and Location selected, a validation error keeps the values and focuses the summary, and the `@phone` spec passes theme-and-axe in light and dark and once in English.
- `e2e/correct-transfer.spec.ts` — not rewritten. The correction stays inside the detail, and a flight value opens Više, so the existing spec still passes.

## Code review

Fixed point `origin/develop`. The reports below are the review before the last two fixes: the other-user e2e now drops the cookie without the client sign-out, so a stored draft stays on the browser while the next user is signed in, and a pickup time that differs from the opened clock is unfinished work.

## Standards

**Hard:**

- `app/components/TransferFormFields.vue` — the quick-add Client form uses catalog copy that still says “klijent”: `t('clients.add')`, `t('clients.submit')` (“Dodaj klijenta”), and the pending line `t('clients.submitting')`. ADR-0038 “Croatian and English labels” says Client is “Naručitelj” in the UI, while code terms stay Client (`GLOSSARY.md`). This diff already renamed `transfers.client` / `chooseClient` / `clientMissing`. The nested form did not.

Fixed after the review: the quick-add heading, submit, and pending line use `transfers.quickClient`, `transfers.quickClientSubmit`, and `transfers.quickClientSubmitting`.

**Judgement:**

- **Duplicated Code** — `TransferDay.vue` pastes the same `TransferForm` and `TransferRideDetail` block into the beside panel and the slideover (`v-if="adding"`, `persist-draft`, `v-model:clients`, `:user-id`, `@recorded` / `@close`). One panel host would carry both layouts.
- **Duplicated Code** — a new Transfer is opened twice. `TransferDay.vue` watches `newTransferNonce` and calls `startAdd()`, and `onMounted` calls `recallTransferDraft`. `useTransferForm` (`persistDraft`) watches the same nonce, calls `openAdd()`, and `restoreDraft()` recalls again.
- **Duplicated Code** — `onCreateClient` / `onCreateStart` / `onCreateEnd` in `TransferFormFields.vue` are the same shape: `open*(item)` then `nextTick` + `rejectFreeText` clearing the id. `addClient` and `addPlace` repeat the empty / too-long name ternary.
- **Mysterious Name** — `placePending` also means “creating a Client”: in `addClient`, `placePending.value = true`, and the status line is `placePending ? (clientTarget ? t('clients.submitting') : …)`.
- **Speculative Generality** — `applyTransferDraftEvent(..., 'edit')` returns immediately (`transfer-draft.ts`), and `closeForm('edit')` calls it. Save, discard, and sign-out are the only events that remove a key.

## Spec

## (a)

Issue #259: "e2e: a reload restores the draft; \"Odbaci\" removes it; another user on the same browser never sees it." Reload and Odbaci are covered. The other-user checks run only after Odbaci and sign-out, when storage is already empty, so they never show that a draft still on the browser stays hidden from the next user.

Fixed after the review: the spec signs the cookie out through the request, leaves the draft in `localStorage`, and only then signs in as the other user.

## (b)

Issue #259: "\"+ Dodaj ‘…’\" opens a small form (a Client's name and kind; a Location's name and address with suggestions)". The Location form also requires kind (Vrsta). The handoff says `POST /api/locations` requires it. That control is not in the spec's small form.

## (c)

Issue #259 lists "Client reference" among the basic fields, and ADR-0038 says "The Client reference is basic because it is the only tie between an arrival and its return journey." The field is on the form and in the draft, but `bookingBody()` does not send it, and a correction sets `clientReference` to `''`. A saved Transfer drops the reference. The handoff flags this. The same ticket says "no migration," so the field cannot be stored as specified.

Issue #259: "An unfinished new Transfer is kept as a browser draft" and "a reload restores the draft." `transferDraftIsBlank` ignores `pickupWall`, so a form whose only edit is the date and time is removed and does not come back.

Fixed after the review: the clock counts when it differs from the value the form opened with.

The handoff does flag the rewrite of `e2e/transfers.spec.ts`, the new `e2e/transfer-form.spec.ts`, and why `e2e/correct-transfer.spec.ts` was left unchanged.
