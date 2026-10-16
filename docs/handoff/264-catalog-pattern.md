# 264 Catalog pattern: Vozači, Vozila, and Revizija

No server change and no migration. Partners and the Client card tabs stay as they are.

## Decisions

- Vozači and Vozila reuse `CatalogPanel.vue` and `catalogSearchMatches` from #263. Search filters the loaded rows. It does not call the server again.
- A Driver has no archive, so that list has no "Prikaži arhivirano" and no `⋮`. A Vehicle archives from `⋮` with the existing confirm. An archived row opens read-only.
- The row and the name (or plate) control both open the record. `+ Dodaj` opens the same panel empty.
- Document expiry dates stay calendar days formatted as they were (`1.6.2027.` / `01/06/2027`).
- Revizija stays Admin-only on the existing `admin` middleware. The table is when, who, action, and detail. The former "Član" column is folded into detail. Refresh is still manual. There is no search and no automatic refresh.

## Specs rewritten

- `e2e/drivers.spec.ts` — the list opener is `+ Dodaj`, the panel submit is "Dodaj vozača", edit is the row, and search filters the loaded names. The audit assertions are unchanged.
- `e2e/vehicles.spec.ts` — same opener and row edit. Archive stays under `⋮`. "Prikaži arhivirano" replaces "Prikaži arhivirana". Search covers the plate. An archived row opens read-only.
- `e2e/vehicles-hardening.spec.ts` — add uses `+ Dodaj`; the archived-plate conflict still opens from the row, not "Ispravi vozilo".
- `e2e/catalog-empty-validation.spec.ts` — empty copy now says what is empty and what to do next; roster still says "Još nema vozača."
- `e2e/theme-pages.spec.ts` — drivers and vehicles open `+ Dodaj` and still run theme and axe.
- `e2e/audit.spec.ts` — the compact four columns are asserted; refresh and Admin-only redirects stay.
- `e2e/catalogs.spec.ts` — added `@phone` coverage for drivers, vehicles, and audit beside the table at 1440 px, two-line rows after create, light and dark axe, and English once on audit.

E2e was not run in this slice (another agent holds the machine). `pnpm lint`, `pnpm typecheck`, and `pnpm test` (536) passed. No migration.

## Code review

Fixed point `240aa10` (merge of #263). After the first commit: archive confirm still uses `xl` (same as LocationList); `watch(generation)` still reloads Audit when another office screen bumps it — that was already today's behaviour. Two-line phone rows and the archived read-only open were then pinned in the specs. An archived Vehicle submit now returns before PATCH.
