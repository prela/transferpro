# 475 One shared unclosed-mark rule

Out of scope: the occupied-end clock and removing the landing alarm stay #476.

## Decisions

- `unclosedMarkOn` is the one rule. Office home and the day read both call it. Neither compares against 60 minutes itself.
- The rule receives the pickup, the stored landing, and the transfer duration. Temporarily the answer is still the scheduled pickup plus 60 minutes, and that instant is included. A stored landing and the duration do not move it. ADR-0055's occupied end replaces that answer in #476, in this function.
- An in-progress Ride and a handed-off Ride share the rule. Unassigned, waiting on acceptance, and finished Rides do not take the mark. That qualification stays at the call sites.
- The day read returns `unclosedMark`. The day board files that flag and does not keep a second clock. The landing alarm stays its own urgent kind, its own Pozornost group, and its own refresh key.
- Comments name the pickup-plus-60 answer as temporary. They do not treat ADR-0027 as the current decision. `f928d8d` is that wording, after the review below. Behavior did not change.
- No migration, no mail, and no screen copy change.
- The reports below are verbatim from the review of the working tree at `210a4bb`, before the comment commit.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (964) passed. `pnpm test:e2e` passed (345, 5.7m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

## Standards

### Hard — documented standards

`unclosedMarkOn` and the comments around it contradict ADR-0055 and the glossary. AGENTS.md forbids that: do not contradict an ADR; update `GLOSSARY.md` or an ADR when a decision changes.

GLOSSARY **Unclosed mark** and ADR-0055: an in-progress or handed-off Ride, 60 minutes after the occupied end (stored landing plus the transfer duration, otherwise the scheduled pickup plus that duration). ADR-0055 supersedes ADR-0027’s pickup-plus-60 rule and “a recorded landing does not move that instant,” and supersedes ADR-0030’s landing alarm. The fixed 60 minutes, and display-only, still stand.

- `shared/unclosed-mark.ts`: the body uses only the pickup (`nowMs - pickup >= UNCLOSED_MARK_MS`). `landingAt` and `transferDurationMinutes` are unused. The comment says the mark “stays at the scheduled pickup (ADR-0027).”
- `shared/transfer.ts`: “On at the scheduled pickup plus 60 minutes… A stored landing does not move it (ADR-0027).”
- `shared/office-home.ts`: “the answer is still the pickup (ADR-0027).”
- `server/modules/transfers/infrastructure/transfers.ts`: “still decided from the pickup (ADR-0027).”
- The new tests pin those superseded sentences: `shared/unclosed-mark.test.ts` (“neither moves the mark”); `transfers.test.ts` (duration 90 leaves `unclosedMark` true, and `landingAlarm` stays a second clock).

ADR-0055 and the glossary require `landingAt` and `transferDurationMinutes`, so they stay on `UnclosedMarkInput`. That standard overrides the Speculative Generality baseline.

### Judgement — baseline smells

**Duplicated Code.** The new `dayRide` in `transfers.test.ts` repeats the landing-alarm test’s row literal (the same Ride fields, plus `pickupAt`, `handed_off`, and `partnerId`).

**Duplicated Code.** The qualifier is written twice: `openForMark = inProgress || row.state === 'handed_off'` in `toDayRide`, and `unclosed = inProgress || ride.state === 'handed_off'` in `classifyRideAttention`. Office home calls `unclosedMarkOn` only from those two branches. The threshold lives in `unclosedMarkOn`. The qualifier is still spelled out at each call site.

## Spec

**(a) Missing or partial.** None. `unclosedMarkOn` is the one rule. Office home (`buildOfficeHome`) and the day read (`toDayRide`) both call it for an in-progress Ride and a handed-off Ride, and neither still compares against 60 minutes. The rule takes the pickup, the stored landing, and the transfer duration, and the answer is still `now − pickup ≥ 60 minutes` (the instant included). A stored landing and the duration do not change it. The landing alarm is still `landingAlarmOn`, still the urgent kind `landing-alarm`, still its own Pozornost group, and still the refresh key `landing-alarm:{rideId}`. List placement is still the same boolean: in progress stays on its list until that instant, then Pozornost only, and a handed-off Ride is a count until then.

**(b) Scope creep.** None. No occupied-end clock, no landing-alarm change, no screen copy change. The new day-ride `unclosedMark` field is how the board drops its own clock.

**(c) Implemented but wrong.** None. Eligibility stays outside the rule, as the rule’s inputs specify. `classifyRideAttention` shows the day read’s flag and does not keep a second 60-minute comparison.
