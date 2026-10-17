# 311 e2e axe waits for animations

Out of scope: putting the enter animation back on the meet sign (#267). `DriverTabla` stays `:transition="false"`.

## Decisions

- `expectNoAxeViolations` waits for finite CSS animations and transitions (`document.getAnimations()` → `finished`) before `analyze()`. The budget is 2s. When it expires, the fixture `console.warn`s the leftover count and still runs axe.
- `Animation.pending` is a boolean, not a playState. An animation stays in the wait while that boolean is set or `playState` is `running`.
- Infinite animations (a loading spinner) are not waited on. A target inside `[data-slot="progress"]` is not waited on either: the toast countdown replaces its `transition-transform` on every tick, so `finished` never arrives.
- Axe tags are unchanged. The app does not turn motion off.
- The `color-contrast` miss from #304 does not reproduce locally. With the wait removed, the invite dialog still passed axe while its enter fade was running. Holding that dialog at opacity 0.9 also returned no `color-contrast` violation from axe 4.13. Damir's decision: delete `e2e/axe-dialog.spec.ts`. It does not prove a regression, because it passes without the wait. There is no regression spec.

## Tests

`e2e/axe-dialog.spec.ts` was added and then removed. No other test was weakened. No migration.

`origin/develop` was merged (`e223041`, including #315). Then a fresh `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (608) passed.

`PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright" pnpm test:e2e` — 260 passed (3.4m). `console.warn` lines about animations still running before the axe check: 0.

## Code review

Fixed point `origin/develop`. The review below is of the fixture after the spec was removed.

### Standards

No hard breach in `e2e/fixtures/axe.ts`. The wait lives in the shared axe fixture, so callers stay on `expectNoAxeViolations`. `console.warn` is owned by `no-console` and the Logging rule; tooling allows it in this file.

**Mysterious Name** (judgement). `finiteRunning` also keeps animations whose `pending` boolean is set:

```34:39:e2e/fixtures/axe.ts
    const finiteRunning = () => document.getAnimations().filter((animation) => {
      // playState is idle, running, paused, or finished. `pending` is a
      // separate boolean, true while an asynchronous play() or pause() has
      // not taken effect. It is not a playState.
      if (!animation.pending && animation.playState !== 'running')
        return false
```

`remaining` is a count, and the warning reads like time left.

### Spec

The issue asked for a test: a dialog with an animation, axe called immediately after open, no false contrast. That spec was deleted. The #304 failure does not reproduce here, so the test cannot show a regression. The fixture wait, the 2s timeout that warns and continues, the progress-bar skip, and the untouched meet-sign dialog remain.
