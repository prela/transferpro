# 372 Pin the operational clock in board specs

Out of scope: product code, migrations, and specs that open one stored day with `?day=`.

## Decisions

- Board specs that seed a Ride on the operational day the board opens on call `pinOperationalClock` before the first navigation. The seed reads that same instant, so a wall clock crossing 05:00 Europe/Zagreb cannot move the board onto the next day while the Ride stays behind.
- Expected-arrival and landing-time pin the browser to noon on the previous operational day. Noon on the day that contains 05:00 is still in the future, so it is not a past pickup and does not appear under Pozornost. That previous noon is already past at 04:55, 05:00, and 05:05.
- Landing-alarm keeps a pickup 90 minutes before the real server clock, because the alarm uses the server. After a locale or theme return it opens the pinned day, waits for hydration, then selects the pickup day. Both `#transfer-day` checks stay.
- Unavailability captures one instant at the start of each test and fills `#transfer-day` after hydration. It does not install `page.clock`.
- `shared/date.test.ts` locks the three previous noons with ISO literals for 20 October 2026. The test does not call the e2e helper, so `shared/` does not import `e2e/`.

## Code review

Fixed point `origin/develop`. The reports below are the review of the uncommitted diff that became `c4274e0`.

### Standards

**Hard violations:** none. `e2e/fixtures/operational-clock.ts` imports `shared/date` the same way the specs already did. ADR-0018 is not crossed. New comments use operational day and calendar date as in `GLOSSARY.md`. No test is removed or softened (`AGENTS.md`). No second date formatter (`docs/agents/working-rules.md`, i18n).

**Judgement — Duplicated Code.** The same hook is copied into 16 specs. Fourteen share this block (`correct-transfer`, `day-list-accept-by-phone`, `record-landing-time`, `ride-assign`, `ride-change`, `ride-occupation`, `stale-save`, `transfer-form`, `transfers-filters`, `transfers-table`, `transfers`, `work-order-assign`, `work-order-cancel`, `work-order-change`):

```ts
test.beforeEach(async ({ page }) => {
  // One instant for the seed and the board, including across 05:00.
  await pinOperationalClock(page)
})
```

`operational-day.spec.ts` and `landing-alarm.spec.ts` are the same call with a different comment. `expected-arrival.spec.ts` and `landing-time.spec.ts` share a second copy that passes `previousOperationalNoon()`. The clock lives in the fixture; the hook does not.

**Judgement — Duplicated Code** (second shape of the same change). `e2e/unavailability.spec.ts` does not call the fixture. It adds `let specNow` and `rideDay()`, and each test sets `specNow = new Date()`. `showRideDay` then fills `#transfer-day` when the board disagrees. That is the pin, rewritten next to the helper the other specs use.

**Judgement — Duplicated Code**, low. `previousOperationalNoon` and the new case in `shared/date.test.ts` are the same steps. The test never calls the helper. Keeping `shared/` from importing `e2e/` justifies the split.

Shotgun surgery is the same finding as the copied hook, not a separate one. `specNow` is a mild mysterious name; the comment above it says what it holds.

### Spec

**(a) Missing or partial.** None for the four named specs. Each now shares one instant between the seed and the board (`page.clock` via `pinOperationalClock`, or `previousOperationalNoon` for the two Pozornost specs). Expects in `landing-alarm` still check `#transfer-day` before and after the fill.

“These specs (and any other spec that computes times relative to now around the operational-day boundary)” — other `e2e` uses that still call `new Date()` or `operationalDateInTimeZone` are out of scope: ride-detail, occupation-strip, duplicate-return-print, and command-palette pass one day in `?day=`; driver-rides fills the same calendar date (pickup 16:00); accept-by-phone, expiring-documents, roster, licence dates, and `seed.ts` archive time are a calendar date or a stored instant; office-home offsets do not flip at 05:00.

`unavailability` is in scope and covered: one `specNow`, pickups at 12:00, and the board forced onto that day after hydration.

**(b) Scope creep.** `shared/date.test.ts` adds a unit test the issue did not ask for. “Test-only change. No migration, no product code” still holds. It does not call `previousOperationalNoon`.

**(c) Implemented but wrong.** None that break “Each spec passes when the clock is set to 04:55, 05:00 and 05:05 Europe/Zagreb.” `previousOperationalNoon` is still derived from the wall clock, then the browser is pinned to that noon. That noon is before 04:55, 05:00, and 05:05, so the Pozornost row stays past. “No assertion is weakened or removed” holds.
