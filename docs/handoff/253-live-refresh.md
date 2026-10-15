# 253 Shared live refresh

Out of scope: Transfers, the Driver list, the Pozornost block, and the "Vožnja je promijenjena" warning on an open form.

## Decisions

- The shared refresher is `createLiveRefresh` in `shared/live-refresh.ts`. Home calls it through `useLiveRefresh`. Transfers and the Driver list adopt that controller; do not add a second timer.
- `LIVE_REFRESH_MS` is 60 seconds. A hidden tab sends no automatic request. Returning to a visible tab, or a `resume` event while visible, reloads at once when the switch is on. "Osvježi" runs while the switch is off. Turning the switch on arms the timer and does not reload immediately.
- The first successful read records urgent keys and does not announce them. A later read announces only keys that were not in the previous success. The polite region is cleared before the sentence is set again, so a second new urgent item is announced. An unchanged refresh clears the region.
- Today's urgent keys are `unassigned-alarm`, `unclosed-mark`, and `landing-alarm` on the office-home read. Past-pickup and decline keys wait for the Home rebuild.
- A failed office read keeps the rows and says "Nije osvježeno, zadnje u HH:MM". The timestamp follows the office read. Expiring documents stay on screen when a later read fails; the first read may still show the loading copy or the document error.
- The refresh row uses size `sm` on the desktop and `min-h-11` below `lg`.
- No migration.
- e2e: `pnpm exec nuxi build && pnpm test:e2e` — 167 passed.

Changed specs, rewritten rather than deleted:

- `e2e/office-home.spec.ts` — the test that waited 1.5 s and asserted Home has no timer now uses Playwright's clock: a reload after 60 s while visible, no request while hidden, an immediate reload on return, the switch, the failure line, scroll and focus, and the polite region. The button name is "Osvježi".
- `e2e/landing-alarm.spec.ts` — the same button name only. The landing alarm assertion is unchanged.

## Code review

Fixed point `origin/develop` (`74c796fb`). The reports below are the review of `5cf3267`. `474ca9c` addresses both hard violations, the document list and the repeated announcement in Spec (c), the `follow` name, and the `addedKeys` export. `clockLabel` still slices `formatInstant`. The urgent key stays a string. This file is the handoff Spec (a) asked for.

## Standards

Fixed point `origin/develop` (`74c796fb`) resolves. The diff is non-empty: `5cf3267`, 12 files.

## Hard violations

**ADR-0038** (“Size `xl` now applies only to the phone layouts… On the office desktop, a control in a row is 28 px.”) The new refresh row is one control row on both layouts, and both controls are `xl`:

```114:139:app/components/OfficeHome.vue
      <UButton
        ...
        size="xl"
        @click="refresh"
      >
...
      <USwitch
        v-model="automatic"
        size="xl"
        :label="t('liveRefresh.automatic')"
      />
```

**ADR-0039** (supersedes “seven” in “the seven counts”; the read is eight counts, the total and seven parts). This commit rewrites the Home comment and still states the old count:

```197:198:app/pages/index.vue
        Office Home is the three lists, the seven counts, and the shared
        live refresh.
```

## Judgement calls

**Working rules, i18n** (“Render instants with `formatInstant`; do not add another date formatter.”) `clockLabel` does call `formatInstant`, then keeps the clock by slicing the string (`formatted.slice(-5)` plus a `HH:MM` check). That is a second clock formatter tied to `formatInstant`’s suffix, not a part read from the formatter.

**Speculative Generality.** `addedKeys` is exported from `shared/index.ts` and only called inside `shared/live-refresh.ts`. `announce(count)` is likewise wider than the UI, which only tests `count > 0` and ignores the number.

**Duplicated Code.** The new e2e helpers walk the same parent chain for an overflow container:

```512:533:e2e/office-home.spec.ts
    let node: HTMLElement | null = main.parentElement
    while (node) {
      const style = getComputedStyle(node)
      if (/auto|scroll/.test(style.overflowY)) {
        node.scrollTop = 360
...
    while (node) {
      const style = getComputedStyle(node)
      if (/auto|scroll/.test(style.overflowY) && node.scrollTop > 0)
```

**Mysterious Name.** `follow` is the queued run, and the name does not say so: `follow = follow === 'refresh' || kind === 'refresh' ? 'refresh' : 'settle'`.

**Primitive Obsession.** Urgent identity is a prefixed string (`unassigned-alarm:${ride.rideId}`), not a kind-plus-Ride-id type. Fine for a set difference; it will get clumsier when past-pickup and decline keys join it.

## Spec

### (a)

"Every e2e spec that pinned the old behaviour is rewritten to assert the new equivalent, never deleted without a replacement; the handoff flags each changed spec and why." The rewrites are in the diff; the handoff is not. There is no `docs/handoff/253-*.md`. `e2e/office-home.spec.ts` no longer asserts "Home has no timer" or the button name "Osvježi početnu"; it now asserts the 60 s clock, the hidden tab, the switch, the failure line, scroll and focus, and the live region. `e2e/landing-alarm.spec.ts` only updates that button name to "Osvježi". No spec file was deleted.

### (b)

None. The shared controller, Home wiring, Croatian and English strings, and the new e2e cover the refresher this issue adopts on today's Home. Transfers, the Driver list, Pozornost, and "Vožnja je promijenjena" are left out, which matches "Transfers and the Driver list adopt it in their tickets."

### (c)

"A failed refresh keeps the data and says "Nije osvježeno, zadnje u HH:MM"; the list is never emptied." Ride rows are kept. The same reload always calls `refreshDocuments()`, and `ExpiringDocuments.loadDocuments` sets `loading` on every call, which replaces that list with the loading sentence. On failure it sets `loadError`, and the template hides the list. That failure does not set the refresher's `failed` flag, so the line can still read "Ažurirano u HH:MM" while the document list is gone.

"A polite live region announces only a new urgent item, not every refresh" and "A new urgent item is announced once." `onAnnounce` receives a count, but the region text is only "Nova hitna stavka" or empty. A later new item, while that sentence is already showing, does not change the node, so a polite region does not announce it.
