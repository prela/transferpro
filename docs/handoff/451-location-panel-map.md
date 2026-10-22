# 451 Map on the office Location panel

Out of scope: the Ride detail map is #452, and the refresh job and `place_ref_checked_at` stay later steps.

## Decisions

- The shared e2e server keeps its existing `MAPS` config. In test the fake adapter returns `about:blank#placeRef=&language=` for an embeddable Location and never calls Google. Outside test, `MAPS=none` or a missing `MAPS_EMBED_KEY` still means no URL (ADR-0052).
- Embed switched off is a unit test on the fake (`setTestMapsEmbedOff`) and a null `embedUrl` on `locationPanelEmbedUrl`. E2E does not toggle that flag. The locations spec is not serial.
- The first address edit hides the button until the panel is opened again after a save. Typing the old address back does not bring the button back, because that save would no longer carry the place.
- No migration. `embedUrl` is still built on the office read and is not stored.
- The phone project pairs light with Croatian and dark with English, and runs axe with the map closed and open. The desktop project covers both locales, both themes, and axe with the map closed and open. Typed, archived, and the Driver card run on desktop.
- A save closes the panel, then reloads the list, which is the same order the panel already uses. The button follows `embedUrl` on that reloaded list.
- The reports below are verbatim from the review of `11852d4...458f415`.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (943) passed. `pnpm test:e2e` passed (338, 5.2m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

## Standards

**Hard:** none.

The panel follows ADR-0052: the iframe is mounted only after the press, Croatian copy is `Prikaži na karti` / `Sakrij kartu` / `Karta: {name}`, both locales ship (`docs/agents/working-rules.md`, i18n), the frame is 240px with `border-default`, `referrerpolicy="strict-origin-when-cross-origin"`, empty `allow`, and no `sandbox`. `locationPanelEmbedUrl` is exported from `shared/index.ts` (ADR-0018). Outside `NODE_ENV=test`, `MAPS=none` or a missing `MAPS_EMBED_KEY` still yields no URL; `maps.test.ts` still asserts that with `NODE_ENV=development`. The test-env fake now returns `about:blank` without a key. That updates the fake’s contract. It does not drop the production assertion (`AGENTS.md`).

**Judgement — Duplicated Code.** `openLocations` in `e2e/locations.spec.ts` repeats the sidebar / Više walk already inline in the phone IATA test:

```331:340:e2e/locations.spec.ts
async function openLocations(page: Page) {
  const sidebar = page.getByRole('navigation', { name: 'Odjeljci' }).getByRole('link', { name: 'Lokacije', exact: true })
  if (await sidebar.isVisible()) {
    await sidebar.click()
  }
  else {
    await page.getByRole('button', { name: 'Više', exact: true }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Lokacije', exact: true }).click()
  }
```

The same block sits at lines 283–291 and was not switched over.

**Judgement — Duplicated Code.** `LocationList.vue` looks up the open row twice:

```268:271:app/components/LocationList.vue
  const location = locations.value.find(item => item.id === editingId.value)
  if (!location)
    return null
  return locationPanelEmbedUrl(location.embedUrl, addressUntouched.value)
```

```293:294:app/components/LocationList.vue
  if (formMode.value === 'edit' && editingId.value !== null) {
    const location = locations.value.find(item => item.id === editingId.value)
```

**Judgement — Divergent Change.** `locationPanelEmbedUrl` puts panel visibility (`addressUntouched`) in `shared/location.ts`, the locations wire contract (ADR-0018). It is a pure, tested predicate, so this is not a breach. The next panel tweak still edits that contract file.

## Spec

### (a) Missing or partial

"Both locales, both themes, phone and desktop, and axe with the map closed and open."

The phone run is only light+Croatian and dark+English. Croatian in the dark theme is never opened, and axe with the map closed and open is not run for the other pairs. "Editing the address closes the map", the typed and archived cases, and "The Driver's card shows no button" run in the desktop project only.

Embed switched off is covered as the owner asked: `maps.test.ts` expects no URL when the test flag is on, and the panel shows the button only when `embedUrl` is set.

### (b) Scope creep

None. Yielding an Embed URL from the fake adapter whenever `NODE_ENV=test`, without changing the e2e server's `MAPS` config, is the owner correction. The driver-card setup is the driver bullet.

### (c) Implemented but wrong

"After the save, the button follows the new `embedUrl`." The accepted timing is the next open after that save.

`onSubmit` sets `formMode` to null, which closes the panel, and only then awaits `loadLocations()`. The save response is parsed with `locationSchema`, which drops `embedUrl`. A reopen before that list request finishes resets the address as untouched and shows the previous URL.
