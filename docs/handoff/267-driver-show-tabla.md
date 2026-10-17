# 267 Driver meet sign

Out of scope: no server change and no migration. Ride steps beyond accept, done, and no-show stay out.

## Decisions

- "Prikaži tablu" / "Show the meet sign" is on the card only when the Ride has a tabla. The card still shows that text at `text-2xl`. The full-screen sign is a fullscreen `UModal`. The visible tabla is one paragraph. The dialog description is a fixed sentence (`driverRides.tablaDescription`: "Pokažite ekran gostu." / "Show the screen to the guest."), because the content slot copies `description` into hidden text.
- Closing restores the list scroll. The offset is read on pointerdown or keydown, before the dialog locks the body (a read after open is already 0). It is written back after the lock releases. A screen wake lock is requested while the sign is open and released on close. A missing API or a refused request does not fail the sign. When the page becomes visible again, the lock is requested again.
- The type shrinks to fit the frame and does not go below 28px. A tabla that still overflows stays at 28px and scrolls inside the frame.
- Contrast is the text token on the working surface (`bg-default`, `text-highlighted`), locked as the `tabla` pair in both themes.
- Merged `origin/develop` after #266 landed as a squash. The driver card and `e2e/driver-rides.spec.ts` keep this branch's copies.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (599 tests). `pnpm test:e2e` passed (254).

Changed specs, rewritten rather than deleted:

- `e2e/driver-rides.spec.ts` — "Meet sign" is an exact label, because the new button "Show the meet sign" contains that text. A Ride with a tabla shows "Prikaži tablu" / "Show the meet sign"; a Ride without one does not. New `@phone` coverage opens and closes the sign, checks that the text fits in portrait and landscape, requests and releases a wake lock, shows the sign when the API is missing, and runs axe in light and dark and once in English.

## Code review

Fixed point `17d9cb9` (`origin/feature/266-driver-next-ride-0abd`). The reports below are the review of `92ced62`, before the description, the 28px floor, and the `guest` return name.

### Standards

No hard breaches. Both locales ship (`showTabla`, `closeTabla`). The sign uses `bg-default` / `text-highlighted`, and the new `tabla` pair matches those tokens (`--ui-bg` / `--ui-text-highlighted` equal working / text in `app/assets/css/main.css`). Tapped controls are `size="xl"`. Wake-lock logic stays in `shared/` and is reached through `shared/index.ts`. `tabla` stays the code term.

**Judgement — Duplicated Code.** The same request/release fake appears twice:

```102:118:e2e/driver-rides.spec.ts
const probe = { requests: [] as string[], releases: 0 }
// ...
async request(type: string) {
  probe.requests.push(type)
  // ...
  async release() {
    released = true
    probe.releases += 1
  }
```

```112:128:shared/screen-wake-lock.test.ts
async request(type) {
  requests.push(type)
  const id = ++nextId
  return sentinel(releases, id)
}
// sentinel(): releases.push(id)
```

Different runners, so sharing it may not be worth it.

**Judgement — Mysterious Name.** `seedMeetSign` returns the guest name under `later`, including when the `later` flag is false:

```1407:1410:e2e/driver-rides.spec.ts
await signIn(page, driver.email, driver.password, tenant.name)
return { later: 'Nika Tabla' }
```

**Judgement — not a breach.** `docs/agents/working-rules.md` (i18n and theme) points at the Nuxt UI guideline that says programmatic overlays use `useOverlay()` instead of `v-model:open`. `DriverTabla.vue` uses `v-model:open`, as every other overlay in `app/` does, including `DriverRides.vue`. ADR-0038 both keeps `UModal` and says the full-screen tabla is built from Reka primitives; `UModal` is that dialog and already has `fullscreen`, which is what ADR-0016 requires when Nuxt UI has the component.

### Spec

#### (a) Missing or partial

**A long tabla can be clipped.** "The text fits the screen width and follows rotation." And: "the tabla text is visible and fits the viewport in portrait and landscape." `fitSign` in `app/components/DriverTabla.vue` shrinks the type only until 16px, then stops, while the frame is `overflow-hidden`. A tabla with no spaces (the field allows 200 characters) wraps one character per line and stays taller than the frame, so part of the text is hidden. Rotation is handled: a window `resize` listener runs the same fitter, and the `@phone` spec checks 390×844 and 844×390 for the short string `GOSPOĐA HORVAT`.

The other acceptance lines are in the diff. The card still shows the tabla at `text-2xl`, and "Prikaži tablu" is an extra full-width button only when `ride.tabla` is set. Closing saves `window.scrollY` and restores it on `after:leave`. `createScreenWakeLock` requests `screen` while open, releases on close, and swallows a missing API or a refused request. `shared/theme-contrast.ts` adds a 4.5:1 pair of the text token on the working surface for both themes, which matches `bg-default` / `text-highlighted`. `@phone` specs in `e2e/driver-rides.spec.ts` cover open/close and fit, an unsupported wake lock, and axe in light and dark with English once on light. Labels are "Prikaži tablu" and "Show the meet sign"; the code field stays `tabla`. No server file and no migration. Existing driver e2e assertions were extended, not removed. `docs/handoff/267-*.md` is absent; that file is a `/conclude` deliverable, not required in this diff.

#### (b) Scope creep

None. Re-requesting the lock when the page becomes visible again is what keeps the screen on for the whole time the sign is open, after the browser drops a screen lock on hide.

#### (c) Implemented but wrong

None beyond the 16px floor in (a). The contrast pair uses the same colours the modal paints. The English action uses the glossary term "meet sign" rather than renaming `tabla`.
