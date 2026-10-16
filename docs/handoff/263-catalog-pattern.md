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
