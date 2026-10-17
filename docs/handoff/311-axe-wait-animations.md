# 311 e2e axe waits for animations

Out of scope: putting the enter animation back on the meet sign (#267). `DriverTabla` stays `:transition="false"`.

## Decisions

- `expectNoAxeViolations` waits for finite CSS animations and transitions (`document.getAnimations()` → `finished`) before `analyze()`. The budget is 2s. When it expires, the fixture `console.warn`s the leftover count and still runs axe.
- `Animation.pending` is a boolean, not a playState. An animation stays in the wait while that boolean is set or `playState` is `running`.
- Infinite animations (a loading spinner) are not waited on. A target inside `[data-slot="progress"]` is not waited on either: the toast countdown replaces its `transition-transform` on every tick, so `finished` never arrives.
- Axe tags are unchanged. The app does not turn motion off.

## Tests

No test removed or weakened. `e2e/axe-dialog.spec.ts` is new. No migration.

`origin/develop` was merged first (`3d85545`). Then `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (604) passed. `pnpm audit --audit-level=high` exited 0.

Only `e2e/axe-dialog.spec.ts` was run, on port 3111, against that build. The whole suite was not run.

- Without `await waitForCssMotion(page)` (that line removed, not committed, then restored): `1 passed (6.5s)`. The test did not fail, and the output had no `color-contrast` violation. The dialog's opacity animation was still running when axe was called. A later probe, also not committed, held that dialog at opacity 0.9 and axe 4.13 still returned no `color-contrast` violation.
- With the wait restored: `1 passed (5.8s)`, test body 2.3s.

## Code review

Fixed point `origin/develop`. The reports below are the review of `be5dca2` after the develop merge.

### Standards

No hard breach in `e2e/fixtures/axe.ts` or `e2e/axe-dialog.spec.ts`.

The new spec asserts Croatian copy (`Pošalji pozivnicu`), which matches `docs/agents/working-rules.md` (e2e: specs assert Croatian copy). Glossary terms are unused or used as `Tenant` in code. The wait lives in the shared axe fixture, so callers stay on `expectNoAxeViolations`. `console.warn` is owned by `no-console` in `eslint.config.mjs` and the Logging rule in `working-rules.md`; skipped because tooling enforces it.

**Mysterious Name** (judgement). `finiteRunning` also keeps animations that are `pending` and not `playState === 'running'`:

```34:39:e2e/fixtures/axe.ts
    const finiteRunning = () => document.getAnimations().filter((animation) => {
      // playState is idle, running, paused, or finished. `pending` is a
      // separate boolean, true while an asynchronous play() or pause() has
      // not taken effect. It is not a playState.
      if (!animation.pending && animation.playState !== 'running')
        return false
```

`remaining` is a count of those animations, and the warning reads like time left: `` `... after ${MOTION_TIMEOUT_MS}ms ...: ${remaining}` ``.

**Duplicated Code** (judgement). The spec repeats the playState-and-effect walk that `finiteRunning` already does, with a different predicate (opacity keyframes versus infinite iterations and the toast progress bar):

```29:38:e2e/axe-dialog.spec.ts
  const dialogFading = await dialog.evaluate(element =>
    element.getAnimations().some((animation) => {
      if (animation.playState !== 'running')
        return false
      const effect = animation.effect
      const getKeyframes: unknown = effect !== null && 'getKeyframes' in effect ? effect.getKeyframes : undefined
      // ...
      return frames.some(frame => frame.opacity != null)
```

The toast, infinity, and idle-frame branches are current caller behavior, so Speculative Generality does not apply.

### Spec

No findings.

**(a) Missing or partial.** None. `expectNoAxeViolations` waits on `document.getAnimations()` → `finished` before `analyze()`, with a 2s timeout. Axe tags are unchanged and no app animation is turned off. `e2e/axe-dialog.spec.ts` opens the invite dialog, asserts the opacity fade is still running, then calls the fixture. The table still uses `:transition="false"`.

**(b) Scope creep.** None. The diff is the fixture wait and that one dialog spec. The timeout warning, the `[data-slot="progress"]` skip, and treating `pending` as a boolean match the QC follow-up.

**(c) Implemented but wrong.** None. On timeout the wait `console.warn`s the leftover count and still runs axe. Pending animations stay in the wait (`!animation.pending && playState !== 'running'`). Progress targets are excluded with `closest('[data-slot="progress"]')`. The dialog spec stretches only that document’s enter animation to 800ms, which is inside the 2s wait, and expects no violations.
