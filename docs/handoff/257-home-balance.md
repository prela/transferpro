# 257 Home balance

Out of scope: overlap, roster-mismatch, and expired-document warnings on the Home row. The office-home snapshot does not carry those kinds.

## Decisions

- Each empty Home list names itself and the next step. Pozornost, Nedodijeljeno, Čeka prihvat, and U tijeku no longer share one sentence.
- A Home row names the calendar date when the pickup is another operational day, including a pickup before the start hour on the same calendar date. The Transfers time cell still uses `pickupNeedsCalendarDate`.
- The phone bar items use `basis-0` so the urgent count on Početna does not push Više past the viewport.
- Expected arrival and a stored landing time stay in the Ride detail. Home shows the urgent row and opens that detail.
- A landing alarm and an unclosed mark are urgent, so those Rides sit in Pozornost and are not repeated on U tijeku.
- The Home action opens the Ride on Transfers. The command itself still runs from that detail.
- The operational-day heading formats a calendar date. `formatInstant` always includes a clock, so that heading stays a date split.
- The "assigned and not started" predicate is written twice, once for the count and once for the Transfers filter. Left as a judgement call.
- No migration, and no RLS policy or grant change.
- e2e: `pnpm exec nuxi build`, then `pnpm lint`, `pnpm typecheck`, `pnpm test` (552 passed), then `E2E_PORT=30257 pnpm test:e2e --workers=2` — 216 passed. An 8-worker run on this machine dropped open listboxes; the same specs passed when run again.

Rewritten specs, and why:

- `e2e/office-home.spec.ts` — eight counts, Pozornost, empty-list copy, and the Početna badge counted from action links.
- `e2e/office-shell.spec.ts` — Početna and Home include the urgent count.
- `e2e/settings-profile.spec.ts` — the English Home link includes the count.
- `e2e/audit.spec.ts` — the sidebar Home link includes the count.
- `e2e/expected-arrival.spec.ts` — the arrival is in the Ride detail opened from Pozornost.
- `e2e/landing-time.spec.ts` — the landing time is in the Ride detail opened from Pozornost.
- `e2e/landing-alarm.spec.ts` — the landing alarm is in Pozornost, not U tijeku.

## Code review

Fixed point `origin/develop`. The reports below are the review of `2bca328` before the follow-up on this branch. Empty-list copy, `homeRowNamesTheDate`, and the phone-bar shrink landed after that review. The handoff file was the missing item the Spec review named.

## Standards

### Hard

**`app/components/OfficeHome.vue` — second date formatter.** `formatOperationalDate` splits `YYYY-MM-DD` and prints `d. m. yyyy.` / `dd/mm/yyyy`, including stripping zeros. `docs/agents/working-rules.md` (i18n): render instants with `formatInstant`; do not add another date formatter. `shared/format-instant.ts` already fixes locale order and padding.

**`app/components/OfficeHome.vue` — empty lists.** Each block uses only `officeHome.empty` (“This list is empty.” / “Ovaj popis je prazan.”). ADR-0038: every list’s empty state says what is empty and what to do next.

### Judgement

**Duplicated Code — “assigned and not started”.** The same predicate is written twice and can drift:

```303:310:shared/office-home.ts
function assignedNotStarted(ride: OfficeHomeRide, pickup: number, nowMs: number): boolean {
  if (ride.driverId === null) return false
  // … closed / unassigned / mustAccept …
  return pickup >= nowMs
}
```

```184:188:shared/ride-attention.ts
function assignedNotStarted(ride: RideAttentionSource, nowMs: number): boolean {
  if (ride.state === 'unassigned' || ride.driverId === null || waitingOnAcceptance(ride) || CLOSED.has(ride.state))
    return false
  return pickupMillis(ride.pickupAt) >= nowMs
}
```

The count uses the first; the Transfers filter from the balance uses the second.

**Duplicated Code — urgent classification.** `officeHomeUrgentKeys` and `unassignedMarks` / `progressMarks` repeat the same past-pickup / four-hour / decline / landing / unclosed cascade (`shared/office-home.ts`).

**Duplicated Code — four list sections.** Pozornost, Nedodijeljeno, Čeka prihvat, and U tijeku each repeat the same `ul` / `OfficeHomeRow` props (`time-zone`, `locale`, `operational-date`, `operational-day-start-hour`).

**Data Clumps.** `place()` takes the ride fields one by one, then copies them into `OfficeHomeBlockRide` (`shared/office-home.ts`). That clump is already the row type.

## Spec

**(a) Missing or partial**

- "the handoff flags each changed spec and why." Rewrites stay in place (`e2e/office-home.spec.ts`, `e2e/office-shell.spec.ts`, `e2e/audit.spec.ts`, `e2e/settings-profile.spec.ts`: Početna now includes the urgent count). Nothing in the diff is a `docs/handoff/257-*.md`.
- ADR-0038: "the urgent item or warning as text." `OfficeHomeBlockRide.marks` is only the five urgent kinds. Overlap, roster mismatch, and an expired document never reach the row.
- "The balance and the lists agree on a seeded day." `e2e/office-home.spec.ts` seeds that day and checks labels, plus that the badge equals the Pozornost row count. It never reads the eight numbers. The sum is only in `shared/office-home.test.ts` on a fixture.

**(b) Scope creep**

None. The extra Transfers filters (`assignedNotStarted`, `done`, `noShow`, `cancelled`) are the count links. The frame-owned read is the shared refresh and the Početna badge.

**(c) Implemented but wrong**

- "Rows are the shared Ride row and open the Ride detail." ADR-0039: "one row per Ride with its action." ADR-0038: "A row carries one contextual action, `Dodijeli` … `Potvrdi telefonom` … `Obavljeno`." `OfficeHomeRow` is a separate control. The row and the action both go to `/transfers?day&ride=`. Those three actions do not run the commands `TransferRideActions` runs.
- "A row from another day shows its date." `pickupNeedsCalendarDate` compares the calendar date to the home operational date. A pickup before the start hour on that calendar date is the previous operational day and is shown as a clock only.
