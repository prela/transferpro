# 388 Already-saved Transfer form

Out of scope: the server still accepts a create without a key; making the key required stays in step 15c-iii. No migration.

## Decisions

- A blank form, a duplicate, and a return journey each mint a new `externalId`. A correction mints none and does not send one. The copy does not reuse the source Transfer's id.
- The key rides in the local draft (`transferpro-transfer-draft:${userId}:${tenantId}`, 24 hours). A blank form is still not a draft: the key alone is not stored, so the next empty form mints another. A reload of a filled form sends the same key.
- On `alreadyRecorded: true` the draft stays, the fields are read-only, and the notice is an info icon plus the Croatian and English copy from the ticket. "Razumijem" / "Got it" clears the draft and opens that Ride on its day. There is no "Zabilježeno." toast on that path.
- Cancel, Escape, and closing the panel keep the draft and the key, and drop the notice. The next send shows the notice again. Only confirm opens the saved Ride.
- Quick-add of a Client or a place stays closed while the notice is up. `42af479` added that, and the assertion that `rememberTransferDraft` drops a key-only payload, after the review below.

## Code review

Fixed point `origin/develop`. The reports below are the review of `f732117`, before `42af479`.

## Standards

No hard breach. ADR-0035 is followed: a new UUID on blank, duplicate, and return; none on correction; `externalId` is sent only on create and is not shown; the draft stays until "Got it"; both locales ship; the notice is `UAlert` plus `i-lucide-info`; light and dark are covered in `e2e/transfer-form.spec.ts`. ADR-0018 does not apply. Tooling-enforced style is skipped.

**Judgement calls**

- **Data Clumps** — `app/composables/transfer-form.ts`. `alreadySaved` and `heldCreate` are set and cleared as a pair (`heldCreate = recorded` / `alreadySaved.value = true`, and the same two lines in `closeForm`, `openAdd`, `openPrefill`, `openCorrect`). One "pending already-recorded result" would do.
- **Duplicated Code** — same file. After a normal create and in `confirmAlreadySaved`, the same tail runs: `ignoreDraft`, `applyTransferDraftEvent(..., 'save')`, `formMode = null`, `loadDay`, `onRecorded`, `onClose`.
- **Duplicated Code** — `restoreDraft` and `openAdd` both mint a key the same way: `if (!entryKey.value) entryKey.value = transferEntryKey('blank')`.
- **Mysterious Name** — `openCorrect` assigns `entryKey.value = transferEntryKey('correction')`, and that call always returns `null`. The name reads as issuing a key.
- **Speculative Generality** — `shared/transfer-draft.ts`. `'already-recorded'` only shares the `'edit'` no-op (`if (event === 'edit' || event === 'already-recorded') return`). The watch already keeps the draft; the new event writes nothing.

## Spec

### (a) Missing or partial

**The notice is not held until confirm.** "keeps the Dispatcher's values in view until they confirm" and "On alreadyRecorded: true the form does not clear the draft. It shows a notice and keeps the Dispatcher's values in view, read-only." Cancel, Escape, and the panel close call `closeForm()` with the default `'edit'` event. That keeps the draft, but it clears `alreadySaved` and `heldCreate` and unmounts the form. Reopening restores an editable draft, not the notice, and the saved Ride cannot be opened without posting again.

**Read-only does not cover the whole form.** "keeps the Dispatcher's values in view, read-only." Only the main `<fieldset>` is disabled. The client and place quick-add forms sit above it and stay editable and submittable.

### (b) Scope creep

None. The opening argument on duplicate and return, the `already-recorded` draft event, the notice focus, and the alert contrast classes all serve the key, the notice, or the axe check.

### (c) Implemented, but wrong

**Confirm is not the only exit, so the specified follow-up is dropped.** "Confirming clears the draft and opens the saved Transfer's Ride detail on its day." `confirmAlreadySaved` does that, and only while `heldCreate` is still set. Any dismiss nulls `heldCreate` first, so that path is gone even though the draft and its key remain.

**A blank-with-key draft is treated as blank, which matches the brief, but the unit test does not lock the store.** "A blank form is not stored as a draft … the key is stored once the form is no longer blank." `transferDraftIsBlank` ignores `externalId`, and `rememberTransferDraft` therefore deletes it. The new test only asserts `transferDraftIsBlank === true`. It never asserts that `rememberTransferDraft` removes a key-only payload.
