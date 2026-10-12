# 160 Clear the conflict alert

Out of scope: office accept-by-phone, and any clear of this alert other than a successful Driver accept on this list.

## Decisions

- The conflict alert stays until a later accept on the Driver upcoming list succeeds. A 409 or a 404 shows it and reloads the list. Any other failure leaves the alert as it was.
- The phone still treats 404 like 409 for that alert. That follows the decision on #159.

## Code review

Reviewed uncommitted `chore/160-clear-conflict-alert` against `origin/develop` (`git diff origin/develop`). No commits at review time. The judgement calls below were fixed before commit: the success comment now says the alert stays until the accept succeeds, and the e2e names the follow-up card `onward` and the list response `upcomingResponse`.

## Standards

No hard violations. `AGENTS.md` (UI change extends `e2e/`; tests are not weakened; no mail). `docs/agents/working-rules.md` (i18n and theme): no new copy; the existing spec still covers `hr`/`en` and light/dark. ADR-0005, ADR-0009, ADR-0018, and ADR-0020 are untouched. Glossary terms in the new comments are Ride and Driver.

**Judgement call — Mysterious Name.** `e2e/driver-rides.spec.ts`:

```633:645:e2e/driver-rides.spec.ts
  let releaseNext = () => {}
  const holdNext = new Promise<void>((resolve) => {
    releaseNext = resolve
  })
  // ...
  const refreshed = page.waitForResponse(response =>
    response.url().includes('/api/rides/upcoming') && response.request().method() === 'GET' && response.ok(),
  )
```

`next` is a locator; siblings are `accepted`, `lost`, `conflicted`. `refreshed` is a response promise, unlike `acceptedResponse` / `conflictResponse`.

**Judgement call — comment vs code.** `app/components/DriverRides.vue`:

```87:88:app/components/DriverRides.vue
    // A tap is not success. The message stays until this accept returns.
    conflict.value = false
```

The block comment above says the alert stays until a later accept succeeds. `conflict.value = false` runs only on the success path; a 409 or 404 sets it again, and any other failure leaves it set. “Returns” overstates the condition.

## Spec

### (a)

None. Both acceptance lines are met: after a 409, the next successful accept clears the conflict alert and reloads the upcoming list (`conflict` is set false only after the accept POST parses, then `loadRides(true)`), and `e2e/driver-rides.spec.ts` covers that sequence, including the alert still showing while the next accept is in flight.

### (b)

None. The product change is only when that alert clears. The extra ride, the held request, and the row, mail, and button checks exist to show the next action succeeded and the list caught up.

### (c)

None. Clearing on a successful accept, not on the tap, matches “The message must disappear on the next successful action.” Accept is the only action on this list.
