# 348 Stale ride query

Out of scope: the office session middleware, the immediate address rewrite on close, and phone Back.

## Decisions

- A `router.push` still waiting on `GET /api/session` is aborted in `onBeforeRouteUpdate` when its ride is not the open Ride. The address is not written. History (`popstate`) is exempt, so Back and Forward still apply the address they land on.
- The guard stores that ride id only. `undefined` means nothing is waiting. `null` is a waiting push with no Ride.
- `router.push` resolves with an abort failure. It does not reject, so `syncAgain` still pushes a Ride opened during the wait. The Standards report below calls the abort a hard break of ADR-0038. That reading is wrong, and the code stays as QC passed it.
- After create, the client-reference spec waits until `?ride=` is present, closes the panel, and reloads only after `ride` is gone. After a correction it waits until `ride` is gone. QC asked for that settlement. The Spec report below still calls the correction wait partial.

## Code review

Fixed point `origin/develop`. The reports below are verbatim.

## Standards

**Hard violation**

`app/components/TransferDay.vue` breaks ADR-0038 (Ride detail): "The open Ride and every filter live in the URL (`?ride=…`)." `onBeforeRouteUpdate` returns `false` when the waiting push's ride is not `openRideId`. That aborts the navigation, so `await router.push({ query })` rejects. `syncQuery` has no catch, and `while (syncAgain)` never runs. A Ride opened while that push is still in the session middleware is not written to `?ride=`. Close is safe only because the aborted push adds nothing. The new comment names the other case ("a different Ride") and does not record it, so that Ride cannot be shared or restored on reload.

**Judgement calls**

Primitive Obsession, same hunk. `inFlightRide: string | null | undefined` is one primitive for three states (nothing waiting, a waiting push with no Ride, a waiting Ride id). The comment carries the meaning the type does not:

```232:247:app/components/TransferDay.vue
let inFlightRide: string | null | undefined
// ...
inFlightRide = undefined
// ...
inFlightRide = queryText(query.ride) || null
```

Duplicated Code, `e2e/ride-detail.spec.ts`. The same `__sessionPending` shift-and-call shape appears twice in the new test: once to release a single fetch, once to drain the queue.

No `CODING_STANDARDS.md` or `CONTRIBUTING.md`. Glossary names in the diff match `GLOSSARY.md`. The new spec meets `AGENTS.md` (a UI change extends `e2e/`). `e2e/transfer-form.spec.ts` still asserts the Client reference after reload. No new copy, so the both-locales rule in `docs/agents/working-rules.md` does not apply. No other baseline smell.

## Spec

(a)

The acceptance line "Revert the workaround in `e2e/transfer-form.spec.ts` (back to `page.reload()`); it passes." is only partly met. `page.goto('/transfers')` is `page.reload()` again, but the reloads no longer run at the old points. After "Zabilježeno." the test waits until the URL has `?ride=`, clicks Zatvori, and waits until `?ride=` is gone. After the correction dialog hides, it waits for that same absence. Before `90244bf`, both reloads ran immediately.

The slowed-session test is present: hold `GET /api/session`, close the panel, reload, and the panel stays shut.

(b)

`e2e/transfer-form.spec.ts` now closes the detail after recording and asserts that the address gains, then loses, `?ride=`. The issue only asked for that file to go back to `page.reload()`.

In `TransferDay.vue`, cancelling a pending push when the open id is a different Ride, and ignoring the guard after `popstate`, stays inside "the last intent wins" and "Back and forward and the scroll position still behave per ADR-0038" ("On the phone, Back from the detail returns to the same list position, with the same filters and the same scroll position.").

(c)

"For a moment the URL has `?ride=<id>` again, until the next push removes it. If the user reloads or copies the URL in that window, the closed panel reopens."

The restored correction reload is gated by `await expect(page).not.toHaveURL(/[?&]ride=/)`. That assertion retries until the query is absent, which is the recovery the bug already had, so the reload sits after the window. This test can pass while that window still exists. The new session test covers a Zatvori click during the held fetch, not this correction reload.
