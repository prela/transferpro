# 187 Office CRUD clients and locations

Out of scope: a Client archive route, Vehicles and Drivers, and an ADR-0016 width change.

## Decisions

- Add and correct for a Client and a Location share one `USlideover` with `UForm` and Zod. Owner decision R6 (12.10.2026) chooses the slideover. Do not move those forms back to the page or into `UModal`.
- A Client has no archive. ADR-0017 keeps the row, and there is no archive route. The row menu is correct only. Do not add a confirm modal that does not archive.
- A Location archive asks in `UModal` before `POST /api/locations/:id/archive`. Cancel leaves the row. An archived row has no menu.
- Row actions are `UDropdownMenu`. The trigger is `actionsFor` (`Radnje: {name}` / `Actions: {name}`).
- `switchLocale` and `switchTheme` wait until the returned page is hydrated. A slideover click during hydration does not open.

## Code review

Fixed point `origin/develop` (`e4cee80`). The diff was the working tree.

## Standards

**Hard.** `ClientList.vue` and `LocationList.vue` put add and correct in `USlideover`. `docs/agents/working-rules.md` (i18n and theme) says a screen change follows `.agents/skills/nuxt-ui` and the guideline it names. `references/guidelines/component-selection.md`: a form is `UModal`; `USlideover` is a detail panel. Archive already uses `UModal`, which matches that row and the destructive-confirm rule.

Otherwise the UI rules hold. Both locales gained `actions`, `actionsFor`, and `confirmArchive`. Fields stay `UFormField` plus `UInput`/`USelect`, `size="xl"`, labeled, Enter via `type="submit"` and `form="…"`. Errors use `role="alert"`; loading uses `role="status"`. Icons are `i-lucide-*`. Responses still go through `clientSchema` / `locationSchema`. ADR-0017 is untouched: no client delete, and the name is not written to the audit log. ADR-0018 does not apply; the diff stays inside each list.

**Judgement.**

- **Repeated Switches.** The same `formMode === 'edit'` cascade is `formTitle`, `submitLabel`, and `onSubmit` in both lists. Quote (`ClientList.vue`): `return formMode.value === 'edit' ? t('clients.saving') : t('clients.submitting')`.
- **Mysterious Name.** `const confirming = ref<Location | null>(null)` does not say archive. The template then shows `confirming.name`.
- **Duplicated Code.** `locationActions` returns `[]` when `archivedAt !== null`, and the cell also has `v-if="row.original.archivedAt === null"`.

Cross-list slideover, dropdown, and empty-state chrome is the same shape. Not flagged: ADR-0018 and `CHARTER.md` (each module owns its UI; no shared starter up front) override extracting it. The parallel Zod form schemas are the i18n message seam; they reuse `CLIENT_*` / `LOCATION_*` bounds and `locationIataError`.

## Spec

### (a) Missing or partial

**Client archive.** "Clients list: archive confirms via UModal and completes the archive flow." The row menu is edit only. There is no confirm modal and no archive request. ADR-0017 says "There is no delete in this ticket," and there is no client archive route, so that line is unmet. Locations do confirm in `UModal` and complete `POST /api/locations/:id/archive`.

### (b) Scope creep

None. Updates in `e2e/transfers.spec.ts`, `e2e/theme-pages.spec.ts`, and the hydration wait in `switchLocale` / `switchTheme` keep existing flows able to open the new slideover. No other page was rewritten. ADR-0016 width was not changed.

### (c) Implemented but wrong

None for add, edit, menu, empty, or loading. Both lists open one `USlideover` with `UForm` / Zod; edit fills it from the row; cancel closes it and the slideover stays dismissible. Empty is `#empty` / `UEmpty`. Loading is `:loading` / `USkeleton`. Location archive cancel leaves the row; confirm removes it.
