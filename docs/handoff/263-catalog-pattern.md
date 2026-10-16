# 263 Catalog pattern: Naručitelji and Lokacije

No server change and no migration. Drivers, Vehicles, Partners, and the Client card tabs (step 18) stay as they are.

## Decisions

- The detail uses the Ride detail layouts: a 420 px panel beside the table from 1440 px, a 420 px overlay below that, and a full-screen panel on the phone. `CatalogPanel.vue` owns that split.
- Search filters the loaded rows (`catalogSearchMatches`). It does not call the server again.
- A Client has no archive, so that list has no "Prikaži arhivirano" and no `⋮`. A Location archives from `⋮` with the existing confirm. An archived row opens read-only.
- The row and the name control both open the record. `+ Dodaj` opens the same panel empty.
- Croatian catalog labels say naručitelj. The audit action titles ("Klijent dodan") stay, because those rows are the audit log, not this catalog.

## Specs rewritten

- `e2e/clients.spec.ts` — the list opener is `+ Dodaj`, the panel submit is "Dodaj naručitelja", edit is the row, and search filters the loaded names. The audit assertions are unchanged.
- `e2e/locations.spec.ts` — same opener and row edit. Archive stays under `⋮`. "Prikaži arhivirano" replaces "Prikaži arhivirane". Search covers the address. Suggestions still run inside the panel.
- `e2e/catalog-empty-validation.spec.ts` — empty copy now says what is empty and what to do next.
- `e2e/office-roles.spec.ts` — the dispatcher still sees the clients empty state and `+ Dodaj`.
- `e2e/theme-pages.spec.ts` — the locations check opens `+ Dodaj` and still runs theme and axe.
- `e2e/transfers.spec.ts` — recording a transfer still creates the client from this catalog first; only the opener and the submit label changed.
- `e2e/catalogs.spec.ts` — new `@phone` coverage for both catalogs, beside the table at 1440 px, light and dark axe, and English once.

Conclude, after `pnpm exec nuxi build`: `pnpm lint`, `pnpm typecheck`, and `pnpm test` (531) passed, then `pnpm test:e2e` on port 3000 — 195 passed. No migration.

## Code review

Fixed point `origin/develop`. The reports below are the review before `f291cd7` (row target, naručitelj labels, and this file).

## Standards

### Hard

ClientList.vue and LocationList.vue — row opener. ADR-0038 (Superseded) keeps size xl for phone controls and sets an office-desktop table control at 28 px. Both name cells use an unsized native button (ClientList.vue lines 222–228, same block in LocationList.vue #name-cell). ADR-0038 (Catalogs) also says the row opens the panel; only this name control does.

LocationList.vue — archive menu. UDropdownMenu is size xl at every width. ADR-0038 (Superseded) limits xl to phone layouts. The trigger class (h-7 / max-lg:h-11) does not change the menu size.

Both lists — phone table. ADR-0038 (Devices and density): a horizontally scrolling table is not the phone layout. Both keep overflow-x-auto and UTable whitespace-nowrap, so a long name still scrolls.

### Judgement

Duplicated Code. The search label, UInput, and + UButton are the same shape in both toolbars. CatalogPanel.vue only slots that markup.

Duplicated Code. CatalogPanel.vue repeats the TransferDay.vue matchMedia listener at 1023 and 1440 then rideDetailLayout. ADR-0038 wants that panel, so sharing the ride layout is not Feature Envy.

catalog.add. ADR-0038 writes the control as `+ Dodaj`. The button also sets icon i-lucide-plus, so the glyph is doubled.

## Spec

### (a) Missing or partial

"the handoff flags each changed spec and why." Rewritten specs existed but the diff then had no docs/handoff/263-*.md.

"a row that opens the same panel as the Ride detail for viewing and editing." Only the name button called openEdit.

### (b) Scope creep

None.

### (c) Implemented but wrong

"Croatian and English labels follow ADR-0038" (Client is "Naručitelj" / "Naručitelji"). + Dodaj, "Prikaži arhivirano", and empty lines match. The panel was still "Dodaj klijenta" / "Dodavanje klijenta"; loading and errors still said klijent.
