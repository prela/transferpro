# 380 Partner screen

Out of scope: Nedostupnost, Vožnje, and any route, RLS, or migration change.

## Decisions

- #354 stays split. This branch is #380. #379 is already merged. The pull request closes both.
- The Podaci tab is on an opened row, including a read-only archived row. The add form has no tabs, the same way a new Client has no card tabs.
- Cjenik and Računi stay out of Katalozi. English copy is Subcontractors.
- The keyboard walk to the Tenant menu allows one more Tab so it can pass the new sidebar stop. That change is after the review below.

## Code review

Reviewed uncommitted `feature/380-partner-screen` against `origin/develop` (`75ed36e`). The reports below are verbatim, before the keyboard-tab follow-up.

## Standards

No hard breach of the named rules. Nav order is Naručitelji, Podizvođači, Lokacije, Vozači, Vozila (`shared/office-nav.ts`), matching ADR-0038. New copy is Podizvođači / Subcontractors (`i18n/locales/hr.json`, `en.json`); the Croatian word "partner" is not used (GLOSSARY). Both locales ship (working-rules, i18n and theme). Fetch results go through `partnerListSchema` / `partnerSchema`. The list mounts only for an office role (`app/pages/partners.vue`). Imports are from `shared` and the same app helpers as the other catalogs. `e2e/partners.spec.ts` covers the screen, both themes, and asserts the audit log does not show the name, phone, email, or note. Shell guard does not apply.

The body `h2` repeats `partners.title`, which `bindScreenTitle` already puts in the navbar (ADR-0038: the page body does not repeat the title). `ClientList.vue` does the same, so this follows the shipped catalog, not a new pattern.

### Smells (judgement)

**Speculative Generality** — one tab and an unused string, for later tickets the screen does not use:

```32:53:app/components/PartnerList.vue
const cardTab = ref<'data'>('data')
// ...
const cardTabs = computed(() => [
  { label: t('partners.tabs.data'), value: 'data' as const },
])
```

`partners.edit` is added in both locale files and never read. The edit title is `openedName`.

**Mysterious Name** — `phoneColumn` also hides email and status:

```55:61:app/components/PartnerList.vue
const phoneColumn = { class: { td: 'max-lg:hidden', th: 'max-lg:hidden' } }
const columns = computed(() => [
  { accessorKey: 'name' as const, header: t('partners.name') },
  { accessorKey: 'phone' as const, header: t('partners.phone'), meta: phoneColumn },
  { accessorKey: 'email' as const, header: t('partners.email'), meta: phoneColumn },
  { id: 'status', header: '', meta: phoneColumn },
```

**Duplicated Code** — the same `#error` alert slot is copied on name, phone, email, and note (`PartnerList.vue` around the four `UFormField`s).

`driverPhoneError` / `driverEmailError` are not Feature Envy: `shared/partner.ts` already stores partner phone and email with the driver schemas.

## Spec

**(a) Missing or partial.** None. The screen is Podizvođači under Katalozi, in the order Naručitelji, Podizvođači, Lokacije, Vozači, Vozila. Search filters the loaded list, the checkbox is "Prikaži arhivirano", the button is `+ Dodaj`, and archive sits under `⋮` with a confirmation. An archived row opens with its fields disabled and no Save. The opened panel’s only tab is Podaci. Copy exists in Croatian and English. The e2e creates, corrects, archives, and restores a Partner, includes an English smoke (heading, search, "Show archived", `+ Add`, empty state, empty-name error), and runs axe in light and dark. No API route, RLS, or migration is in the diff. "Only on transferpro_e2e" stays with the existing e2e harness.

**(b) Scope creep.** `e2e/partners.spec.ts` opens the audit log and asserts "Podizvođač dodan", "Podizvođač ispravljen", "Podizvođač arhiviran", and "Podizvođač vraćen", and that the name, phone, email, and note are absent. Spec: "E2e: create, correct, archive, restore a Partner; Croatian copy plus one English smoke; light and dark; axe clean." Updates in the office shell, role, driver, and signed-out specs only keep the new Katalozi link inside those existing checks.

**(c) Implemented but wrong.** None. Create, correct, archive, and restore call the existing `/api/partners` routes. The Podaci tab is on the opened row, including the read-only archived panel, and not on the empty add form, which is the same catalog pattern as Clients. Spec: "Panel first tab Podaci; Nedostupnost (#357) and Vožnje come later."
