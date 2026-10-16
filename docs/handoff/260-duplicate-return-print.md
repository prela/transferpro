# 260 Duplicate, return journey, and print the day

No server change and no migration. Duplicate and return only prefill the Transfer form. Print is styling.

## Decisions

- A duplicate copies the booking, including the pickup in the Tenant time zone, and drops the Transfer id and the Ride id.
- A return swaps from and to. It keeps the Client, Client reference, guest, passengers, luggage, child seats, and payment. Time, flight number, tabla, price, note, and the airport mark start empty.
- The prefill replaces any browser draft and is stored as that same draft, so a reload does not bring the previous unfinished entry back. The server still sees nothing until save.
- "Ispiši dan" prints every Ride of the loaded day, not the filtered rows. Groups are Vehicles ordered by earliest pickup. Unassigned Rides are last. The sheet is mounted only while the page is printing, then teleported to `body`, with written light colours. The print rule only hides the page when that sheet is present.

## Changed specs

- `e2e/correct-transfer.spec.ts` — a cancelled Ride used to have no actions button. It now has Dupliciraj and Povratni transfer, and still has no Ispravi transfer.
- `e2e/duplicate-return-print.spec.ts` — new. A return saved from the detail is a second Transfer with no id link. Print in the dark theme is light, grouped, with unassigned last, in Croatian and English.

## Code review

Fixed point `origin/develop`. The reports below are from the review before the print sheet was moved to `body` and before a return stopped copying price, note, and the airport mark. The follow-up commits address the hard glossary word, the extra copied fields, and the sheet that stayed hidden under `display: none`.

## Standards

**Hard**

`shared/transfer-prefill.ts` — the return-journey comment says the office fills “the new leg.” `GLOSSARY.md` (**Ride**) lists *leg* under *Avoid*, and `AGENTS.md` requires those terms in code, tests, and tickets. Use Transfer (a return journey is its own Transfer).

**Judgement**

**Duplicated Code.** The same two menu rows are copied in `TransferRideDetail.vue` and `TransferRideRow.vue`:

```text
items.push({ label: t('transfers.duplicate'), icon: 'i-lucide-copy', onSelect: () => emit('duplicate'…) })
items.push({ label: t('transfers.returnJourney'), icon: 'i-lucide-undo-2', onSelect: () => emit('returnJourney'…) })
```

`priceForLocale` in `shared/transfer-prefill.ts` (`locale === 'hr' ? amount.replace('.', ',') : amount`) repeats `priceForForm` in `app/composables/transfer-form.ts`. No documented shared price formatter, so this stays a smell.

**Mysterious Name.** `moreSync` in `app/composables/transfer-form.ts` is a counter bumped so Više reopens (`moreSync.value += 1`). The name does not say that.

**Checked and not counted.** Both locales ship (`docs/agents/working-rules.md`, i18n). Instants go through `formatInstant`. Imports are from `shared/index.ts` (`AGENTS.md`; ADR-0018). Print uses Lucide and a native table with written light colours, which ADR-0038 requires for “Ispiši dan”; the same ADR’s Reka/token sentence already allows a native table for the roster grid. The `⋮` plus detail wiring matches that ADR, so it is not shotgun surgery. `printDay` only calls `window.print()`; too small to treat as a Middle Man.

## Spec

### (a) Missing or partial

None. Both menus prefill a new form and save goes through the existing create path. Unit tests cover both prefills, the swapped route, and the emptied time, flight number, and tabla. The return e2e checks a second Transfer whose payload does not contain the first id. Labels are Dupliciraj / Povratni transfer / Ispiši dan and Duplicate / Return journey / Print the day. `e2e/correct-transfer.spec.ts` is rewritten and named in the handoff. The diff has no server or migration files.

### (b) Not asked for

A return also copies price, note, and the airport mark. The spec only says it "keeps the Client, Client reference, guest, passengers, luggage, child seats, and payment" and "leaves the time, the flight number, and the tabla empty."

Print rules in `main.css` apply to every page. `@media print` sets `body * { display: none }`. The spec limits this to Transfers: "It is print styling only."

### (c) Implemented, but wrong

"Ispiši dan" should print the shown day in light colours. The sheet is not a direct child of `body`, and `body * { display: none !important }` hides its ancestors. A `display` on `.transfer-day-print` does not reveal a subtree under `display: none`, so the light sheet does not print. The handoff says that e2e was not run.
