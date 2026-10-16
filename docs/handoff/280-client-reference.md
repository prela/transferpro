# 280 Client reference on Transfer

The Naručitelj column does not show the Client reference in small text, and cross-day search and return-journey prefill stay out of this ticket.

## Decisions

- The field stays with the always-shown basic fields (ADR-0038), after passengers and before payment. A stored reference does not open Više.
- Blank becomes null. The length limit is 200. The audit row may name `clientReference` and does not store the number.
- A correction that changes only the reference does not mail a work order (ADR-0026).

## Code review

Fixed point `origin/develop`. The reports below are the review of `8000e9b`, before the field moved out of Više.

## Standards

### Hard

**`app/components/TransferFormFields.vue`** — Client reference sits inside `#transfer-more` (`v-show="moreOpen"`), after the Više toggle. `docs/adr/0038-office-and-driver-ui.md` (Transfer form): basic fields always shown include Client reference, because it is the only tie between an arrival and its return (`ADR-0003`). Više holds the flight number, the airport mark, the tabla, luggage, child seats, and the note. `e2e/transfer-form.spec.ts` now expects the label hidden until Više/More. `transferMoreHasValue` in `shared/transfer-draft.ts` treats a reference as a reason to open Više.

**Day table** — ADR-0038 (Transfers): the Naručitelj column shows the Client reference in small text. `TransferRideRow.vue` is unchanged; the client cell is still only `clientName()`. The diff passes `ride.clientReference` into day search in `TransferDay.vue` and does not render it.

### Judgement

**Mysterious Name** — `e2e/transfer-form.spec.ts`:

```ts
async function createdId(page: Page, path: string, data: unknown): Promise<void> {
 const response = await page.request.post(path, { data })
 if (!response.ok())
 throw new Error(`${response.status()} ${await response.text()}`)
}
```

The name says it returns an id. It returns nothing.

**Duplicated Code** — `chooseMenu` in that spec repeats `chooseOption` (`e2e/fixtures/ui.ts`) and clicks the option. The shared helper presses Enter because a pointer click misses when the list is clipped.

No other documented breach. Audit stores the field name `clientReference` and the tests keep the number off the row (`docs/adr/0014-append-only-audit-log.md`; `docs/agents/working-rules.md`, Audit log). The column is nullable, not unique, and trimmed (`docs/adr/0003-channels-and-external-references.md`; `GLOSSARY.md`). Journal `when` is the previous value plus 1000. Both locales ship. The RLS test covers Tenant B. Layered edits follow `docs/adr/0018-module-boundaries.md`, so Shotgun Surgery is not flagged.

## Spec

**(a) Missing or partial**

None. The diff covers the issue’s build list and acceptance lines:

- “nullable text column … covered by existing RLS; RLS test for the new column” — `client_reference` is nullable on `app.transfers`; `transfer.rls.test.ts` shows Tenant B’s select returns no row.
- “create and correct accept the value (Zod, trimmed, length limit); day read returns it” — `optionalLine` trims, blank becomes null, length is 200; `loadRidesForDay` and `transferDaySchema` return `clientReference`.
- “field back under Više, included in the local draft” — the input sits in the Više block; the draft schema, blank check, and Više-open check include it.
- “search matches the reference” and “Day-list search finds a Ride by its Client reference” — `TransferDay.vue` passes `ride.clientReference` into the existing matcher; the filters spec searches `V-19`.
- “A typed reference survives save, correction and reload” — form save/correct plus the form spec.
- “Migration is additive and reversible; backup restore job stays green” — the column is nullable, so existing rows stay valid. Reversal is drop column and restore the previous audit check (same forward-only style as `0038`). The journal entry is what the restore job counts. The job itself is not run in this diff.

**(b) Scope**

The issue’s migration line only asks for a nullable text column. The migration also replaces `audit_entry_shape` so the field name may be stored and the value may not, and adds `transfers_client_reference` (trimmed, length 1–200). Both follow existing Transfer-field rules (audit stores names, not values; note and tabla already have the same style of check). No other product behavior.

**(c) Implemented but wrong**

None. An omitted `clientReference` on create or correct becomes null, same as flight and note. A reference-only correction does not return an accepted Ride to assigned, which matches the existing material-field rule and is not contradicted by the issue.
