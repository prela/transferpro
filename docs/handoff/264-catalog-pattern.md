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
- `e2e/settings.spec.ts` — audit action and detail assertions use the table cells, so the phone second line does not duplicate `getByText`.
- `e2e/catalogs.spec.ts` — added `@phone` coverage for drivers, vehicles, and audit beside the table at 1440 px, two-line rows after create, light and dark axe, and English once on audit.

## Code review

Fixed point `240aa10` (merge of #263).

### Standards

#### Hard

**VehicleList.vue — archive confirm.** ADR-0038 (Superseded): size `xl` applies only to phone layouts. Both modal buttons stay `size="xl"` at every width:

```666:677:app/components/VehicleList.vue
          size="xl"
          class="w-full justify-center sm:w-auto"
          ...
          size="xl"
```

This copies LocationList; ADR-0038 still wins over that leftover.

#### Judgement

**Duplicated Code — `formatDay`.** Same calendar-day split appears in both lists (already in `ExpiringDocuments.vue`). Not `formatInstant`: working-rules.md (i18n) is for instants; handoff 264 keeps these as calendar days.

```174:181:app/components/DriverList.vue
function formatDay(iso: string): string {
  const [year, month, day] = iso.split('-')
  ...
```

**Duplicated Code — toolbar.** Search label, `UInput`, and `+ Dodaj` (`h-7` / `max-lg:h-11`) match ClientList/LocationList. `CatalogPanel` only slots the markup. Same smell the 263 review already called; ADR-0038 wants that chrome.

**Mysterious Name — `openedName` on vehicles.** Holds the plate:

```29:30:app/components/VehicleList.vue
/** The panel title stays the plate that was opened, not the half-typed correction. */
const openedName = ref('')
```

`httpStatus` copies are repo-wide; baseline does not apply.

No ADR-0018, GLOSSARY, or AGENTS import/RLS/audit-data issues in this diff. Phone tables use `lg:overflow-x-auto`, hidden extra columns, and two-line rows, so ADR-0038’s “horizontally scrolling table is not the phone layout” is met. Row `@select` plus the name/plate control match ADR-0038 (Catalogs).

### Spec

#### (a) Missing or partial

**Phone create/edit/archive and two-line rows are only half-covered.**  
Issue: *“Vozači and Vozila follow the pattern on desktop and phone; create, edit, and archive work from the panel.”* ADR-0038: *“a compact table with two-line rows on the phone.”*  
UI adds `driverSecondLine` / `vehicleSecondLine` and `CatalogPanel`. `e2e/catalogs.spec.ts` on the phone only opens `+ Dodaj` and closes it. It never asserts a two-line row (the same file does for Naručitelji). Create, edit, and archive still live in `drivers.spec.ts` / `vehicles.spec.ts`, which use `getByRole('dialog')` on default desktop (overlay), not the 390px project.

**Archived Vehicle as read-only is not the rewritten equivalent.**  
#263: *“archived row read-only.”* After *“Prikaži arhivirano”*, `vehicles.spec.ts` only checks that `Radnje: …` is gone and the *Arhivirano* cell is visible. It never opens the row. Old edit-from-`⋮` was removed; the new open-row path is unpinned.

#### (b) Scope creep

**Audit chrome that the spec did not ask for.**  
Issue: *“the manual refresh it has today, no automatic refresh and no filters.”*  
Refresh is still a button and there is no search. The control moved above the table; first load now uses `UTable` `#loading` skeletons and `UEmpty` instead of the previous status/`<p>` empty. That is extra layout, not a new capability.

#### (c) Looks implemented, looks wrong

**Archived Vehicle is not actually submit-proof.**  
#263: *“archived row read-only.”* Fields are `:disabled` and the save button is `v-if="!archivedView"`, but `onSubmit` still `PATCH`es whenever `formMode === 'edit'` with no `archivedView` guard (same shape as Locations in #263). Enter on the form can still write.

**`watch(generation)` still calls `loadEntries()`.**  
Issue: *“no automatic refresh.”* The button is manual; this watcher is an automatic reload if `useAuditRefresh` increments while Audit is open. The spec’s “today” already had it; this slice kept it.

No server/migration files in the diff (matches *“No server change”* / *“no migration”*). Croatian/English catalog and audit strings match ADR-0038 (`+ Dodaj`, *Prikaži arhivirano*, *Revizijski zapisnik* / *Revizija*). Drivers correctly have no archive/`⋮`. Handoff lists each rewritten spec.

After that review: two-line phone rows and the archived read-only open were pinned in the specs. An archived Vehicle submit now returns before PATCH. The audit refresh stayed at the bottom.

Conclude, after `pnpm exec nuxi build`: `pnpm lint`, `pnpm typecheck`, and `pnpm test` (536) passed, then `E2E_PORT=30264 pnpm test:e2e` — 206 passed. No migration.
