# 382 Click Više inside the open Ride detail

Out of scope: the `/transfers` hydration mismatch, `pinOperationalClock`, and `showRide`.

## Decisions

- On a phone, `openCorrection` waits until the Ride detail dialog named with the guest is visible, then clicks Više only inside that dialog. The shell bar uses the same name until the detail opens, and the pinned clock can leave that bar up for the next click.
- Every phone spec that calls `pinOperationalClock` was checked for a row click followed by Više. The only such site is `e2e/stale-save.spec.ts`.
- The CI trace logged `Hydration completed but contains mismatches` on `/transfers` before the row click. That warning is not this fix. It stays for a separate ticket.
- No migration. No assertion was weakened.

## Code review

Fixed point `origin/develop`. Reports of `a278856`.

## Standards

**`e2e/stale-save.spec.ts` — `openCorrection` phone branch.** No hard violations.

The hunk waits for the dialog named the guest, then clicks `text.more` inside it. That still uses the role and the locale copy (`Više` / `More`). `AGENTS.md` (never weaken or remove a test) is intact: the later `menuitem` and save-button assertions stay. `GLOSSARY.md` Guest is the right name for that dialog. `docs/agents/working-rules.md` (i18n: both locales on a UI change) does not apply; this is a locator fix, and the click already goes through `copy[locale].more`. `CHARTER.md` only requires Playwright coverage and WCAG on shipped UI; the query stays on `getByRole`.

**Baseline smells:** none. `detail` is a locator for that dialog, and the comment says why the shell’s same-named button must be excluded. No second copy of this shape appears in the diff.

## Spec

No findings.

**(a) Missing or partial.** None. `openCorrection` on a phone waits for the Ride detail dialog, then clicks Više inside it (`getByRole('dialog', { name: guest, exact: true })`, then `detail.getByRole('button', { name: text.more })`). The slideover title is the guest name while the detail is open, so that locator is the detail. `pinOperationalClock` and `showRide` are unchanged. No product code, migration, or weakened assertion. The hydration mismatch is absent from the diff.

Phone specs that call `pinOperationalClock` were checked for a row click followed by Više. The only such site is `e2e/stale-save.spec.ts`. `transfers-table`, `transfer-form`, `transfers-filters`, and `record-landing-time` pin the clock and have `@phone` coverage, but they do not click a row and then Više. `ride-detail.spec.ts` clicks a row and later Više, and it does not call `pinOperationalClock`; those Više clicks run only after the detail is already open.

**(b) Scope creep.** None. The hunk is the phone branch of `openCorrection` plus a comment.

**(c) Implemented but wrong.** None. The wait is on the detail dialog becoming visible, which is what the pinned clock delays, and the Više click is scoped to that dialog so it cannot hit the shell bar.

Standards: 0 hard, 0 judgement calls. Spec: no findings.
