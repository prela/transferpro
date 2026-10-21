# 409 Hand a Ride off to a Partner

Out of scope: the handoff screen and its e2e stay in #410; Partner unavailability and `fully_booked` stay in their later tickets.

## Decisions

- QC accepted the landing-time refusal and `ride_partner_unchanged`. Label e2e is deferred to #410.
- Closing clears `partner_id`. The audit stores that Partner id in the driver slot.
- A handed-off No-show is allowed before the wait. After the wait the action is `ride.no_show`; before it, `ride.no_show_early`.
- Migration 0056 does not rewrite existing Rides. `partner_id` is nullable and has no default.
- After the review, the follow-up proved `stale_save`, a driver 403, and a cross-tenant 404 on a Partner change and a take-back, and the No-show action follows the wait. `canCloseHandedOffRide` is what done and No-show call, and the `partnerIsActive` comment sits on that function. The reports below are verbatim, before that follow-up.

## Code review

Reviewed `feature/409-hand-ride-to-partner` against `origin/develop`.

## Standards

**Hard**

`OfficeHome.vue`, `OfficeHomeRow.vue`, `TransferRideRow.vue`, and `AuditLog.vue` change what Home, the board row, and the audit log show. `AGENTS.md` (Workflow): a UI change adds or extends a spec under `e2e/`. This diff has none.

**Judgement**

Duplicated Code. `closeHandedOffDone` (`done.ts`) and `closeHandedOffNoShow` (`no-show.ts`) are the same write: `set state = …, partner_id = null where state = 'handed_off' and partner_id = …`, then append with the Partner id in the driver slot. `writeCancelledRide` repeats the clear.

Speculative Generality. `canCloseHandedOffRide` (`shared/ride-handoff.ts`) is exported and tested and never called. Done and No-show re-check `current.state === 'handed_off'` inline. `canChangeHandedOffPartner` and `canTakeBackHandedOffRide` are that same predicate twice.

Primitive Obsession. Those three take `state: string`. Sibling rules (`canCancelRide` in `shared/transfer.ts`) take `RideState`.

`officeHomeBlocks` builds `handedOffParked` and never reads it. `place()` sends the row to attention because the mark is urgent, so the array is only a sink.

`partners.ts`: the `partnerIsActive` comment was left above `partnerPresenceForHandoff`, so the first block describes a boolean that function does not return.

**Not a breach**

The Partner id in the close entry’s `driverId` slot is what ADR-0048 requires. The seventh-state edits match that ADR’s consequences. Handoff takes the tenant lock and does not judge `fully_booked` or `ride_unavailable`; ADR-0034 schedules both after this handoff. Lock order (Transfer and Ride, then stale and state, then the tenant lock, then the Partner) matches ADR-0034.

## Spec

### (a) Missing or partial

- "A handoff, a Partner change, and a take-back require and bump the ADR-0046 version (`stale_save` on mismatch)." The bump is proven for all three. `stale_save` is proven through the route only for hand-off, not for Partner change or take-back.
- "A Driver gets 403." Proven for hand-off and for done, No-show, and cancel. Not proven through the route for Partner change or take-back.
- "Another Tenant's Partner or Ride is 404." Proven for hand-off. A Partner change onto Tenant B's Partner, and a take-back of Tenant B's Ride, are not in the RLS suite.

### (b) Not asked for

- Landing time and flight asks now refuse `handed_off` (`canRecordLandingTime`, `recordLandingTime`, `isTrackable`). The issue does not mention landing. "A Transfer correction of it is allowed" is the only extra write it names.
- A change to the same active Partner is 409 `ride_partner_unchanged`. The issue does not define that refusal. "can change the Partner" and the archived refusal are the Partner-change rules it states.

### (c) Implemented, but wrong

- "Closing uses the existing done, office No-show, and cancelled actions with the Partner id in place of the Driver id." Done and cancel do that (`ride.done` / `ride.cancelled`, Partner id in the driver slot). A handed-off No-show always writes `ride.no_show_early`, including after the wait has elapsed. The existing office No-show writes `ride.no_show` once the wait has elapsed and `ride.no_show_early` only before it. "with no wait" allows the close before the wait. It does not rename a close after the wait.
