# 190 Office CRUD vehicles and drivers

Out of scope: a Driver archive route, Clients and Locations, and an ADR-0016 width change.

## Decisions

- Add and correct for a Vehicle and a Driver share one `USlideover` with `UForm` and Zod. Owner decision R6 (12.10.2026) chooses the slideover. Do not move those forms back to the page or into `UModal`.
- A Driver has no archive. There is no archive route. The row menu is correct only. Do not add a confirm modal that does not archive.
- A Vehicle archive asks in `UModal` before `POST /api/vehicles/:id/archive`. Cancel leaves the row. An archived row has no menu.
- Row actions are `UDropdownMenu`. The trigger is `actionsFor` (`Radnje: {name}` / `Actions: {name}`). For a Vehicle, `{name}` is the registration plate.
- `switchLocale` and `switchTheme` already wait until the returned page is hydrated. Open the slideover after that wait. A slideover click during hydration does not open.

## Code review

Fixed point `origin/develop` (`9b683a3`). The diff was `3edbad2`.

## Standards

**Hard violations:** none.

Checked against `docs/agents/working-rules.md` (i18n and theme), ADR-0016, `AGENTS.md`, the Nuxt UI form and overlay guides, and ADR-0018. Add and edit use `USlideover`; archive stays `UModal` (owner decision R6, 12.10.2026, overrides the form-vs-slideover row in `component-selection.md`). New copy is in both `i18n/locales/en.json` and `hr.json`. `e2e/theme-pages.spec.ts` still covers light and dark and opens the form. Inputs stay on `UForm` / `UFormField`, `size="xl"`, labeled, with `type="submit"` and `form="vehicle-form"` / `form="driver-form"` so Enter submits. Errors keep `role="alert"`; loading keeps `role="status"`. Icons are `i-lucide-*`. Colors are semantic (`neutral`, `error`, `text-muted`). No new module import. The parallel list chrome is not flagged (ADR-0018 / #187).

**Judgement — Duplicated Code.** The same date check is copied for every expiry field, and again across the two lists:

```78:89:app/components/VehicleList.vue
  registrationExpiresOn: z.string().superRefine((value, ctx) => {
    if (vehicleDateError(value))
      ctx.addIssue({ code: 'custom', message: t('vehicles.dateInvalid') })
  }),
  technicalInspectionExpiresOn: z.string().superRefine((value, ctx) => {
    if (vehicleDateError(value))
      ctx.addIssue({ code: 'custom', message: t('vehicles.dateInvalid') })
  }),
```

`DriverList.vue` repeats it for `drivingLicenceExpiresOn` and `transportLicenceExpiresOn` (`driverDateError` / `drivers.dateInvalid`). One shared refine per schema would do.

## Spec

### (a) Missing or partial

None. Against issue #190: Vehicles and Drivers add and edit share one `USlideover` with `UForm` and Zod; submit creates or updates; cancel and the slideover close dismiss it. Row actions are `UDropdownMenu` (`Actions: {name}` / `Radnje: {name}`). Vehicles archive confirms in `UModal`, then `POST /api/vehicles/:id/archive`; cancel leaves the row; an archived row has no menu. Drivers have an edit-only menu and no archive modal or route. Both lists use `#empty` / `UEmpty` and `:loading` / `USkeleton`. `e2e/vehicles.spec.ts`, `e2e/drivers.spec.ts`, `e2e/vehicles-hardening.spec.ts`, `e2e/catalog-empty-validation.spec.ts`, and `e2e/theme-pages.spec.ts` follow the menu and slideover. Locale switches go through the existing `switchLocale` hydration wait, then the slideover is opened. ADR-0016 is untouched.

### (b) Scope creep

None. The diff is `VehicleList.vue`, `DriverList.vue`, those e2e files, and `actions` / `actionsFor` / `confirmArchive` in `en.json` and `hr.json`. No Clients, Locations, Transfers, Settings, archive route, or shell rewrite.

### (c) Implemented but wrong

None. The Vehicles menu is edit plus archive; the Drivers menu is edit only, matching “same rule as Clients in #187.” Archive cancel only clears the modal target.
