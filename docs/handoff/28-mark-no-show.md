# 28 Mark a No-show when the wait allows it

Out of scope: charging a fee, sending mail, a flight feed, changing the done audit, and a timer that reveals the button while the page stays open.

## Decisions

- `POST /api/rides/:id/no-show` is one route. A driver marks only the Ride they hold. A dispatcher or an admin marks any Ride in the Tenant. The body is empty. Any key is 400 before a session opens.
- The source state is the same pair as done. The copied flag decides it. Off: `assigned`. On: `accepted` only. `canMarkNoShow` is that pair. The update repeats it in SQL so a concurrent command loses. A Ride the Driver does not hold is 404. A wrong state is 409 `ride_not_no_show`. A refusal writes no row and no audit entry.
- The wait is the Tenant's current settings, read at the attempt, under the lock of the Ride and the Transfer. Elsewhere starts at the scheduled pickup and uses the elsewhere wait. An airport starts at the recorded landing time and uses the airport wait. An airport with an empty landing time starts at the scheduled pickup and still uses the airport wait. Elapsed means `now` is at or after that instant. A landing-time or airport-mark change that committed before the lock is the clock the attempt uses.
- The Driver is refused before that instant with 409 `no_show_too_early`. The Ride stays as it was. The office may mark earlier from the same source state.
- After the wait, whoever marks it, the action is `ride.no_show`. An office mark before the wait is `ride.no_show_early`. The actor is the person. Data is `rideId`, `driverId`, and `fields: ['state']`. The screen joins the Driver name and does not join the plate.
- The update sets only `state`. No fee and no charge are stored. The Driver, the Vehicle, the copied flag, and the Transfer price stay. No-show sends no mail (ADR-0026).
- The Ride leaves the Driver upcoming list because that list is only `assigned` and `accepted`. A further transition is refused. The upcoming list also returns the two wait lengths so the phone can hide the button until the wait has elapsed. The office button shows whenever the source state allows it, including before the wait. The server is the authority.
- Both screens confirm before the post. Cancel writes nothing.

## Code review

Reviewed the uncommitted working tree against `origin/develop` (`git diff origin/develop`, plus the untracked command, route, clock, and migration). No commits at review time. The judgement calls below were left.

### Standards

**Hard:** none. `markNoShow` enforces driver / dispatcher / admin itself (`AGENTS.md` role allow-list) via `withTenantFromSession`; the body is Zod-parsed before a session opens. Audit is `appendAuditEntry` on that transaction after the write, with `rideId`, `driverId`, and `fields: ['state']` only (`docs/agents/working-rules.md` Audit log; ADR-0014). Both actions are in `auditActions`, `audit_entry_shape`, migration `0037`, and both locales. Journal `when` is the previous entry plus 1000. No fee column, no mailer (ADR-0007, ADR-0026). Imports stay on module `index.ts` files (ADR-0018). Glossary No-show and Audit entry are updated. UI extends `e2e/` and ships both locales.

**Judgement — Duplicated Code.** `canMarkNoShow` is the same pair as `canMarkRideDone`, and the update repeats it:

```11:13:shared/no-show.ts
export function canMarkNoShow(state: RideState, mustAccept: boolean | null): boolean {
  return (state === 'assigned' && mustAccept === false) || (state === 'accepted' && mustAccept === true)
}
```

```234:238:server/modules/transfers/infrastructure/no-show.ts
      and driver_id = ${driverId}
      and (
        (state = 'assigned' and must_accept is false)
        or (state = 'accepted' and must_accept is true)
      )
```

The SQL guard matches `done.ts`, so that half is the existing concurrency shape. The new function is a second copy of the ADR-0006 pair.

**Judgement — Duplicated Code.** `confirmMarkNoShow` in `DriverRides.vue` and `TransferDay.vue` both `POST` `{ }` to `/api/rides/${id}/no-show` and parse `rideSchema`, with the same open/close/pending dialog. The done dialogs are already split per screen.

**Judgement — Mysterious Name.** The clock field is `airport`, while the Transfer field and ADR-0007 term are the airport mark:

```19:21:shared/no-show.ts
export interface NoShowClock {
  readonly airport: boolean
```

### Spec

**(a) Missing or partial**
None. Source state matches done (`assigned` when the copied flag is off, only `accepted` when it is on) for the Driver and the office. The Driver is refused before the wait, with the Ride unchanged. The office may mark early from that same state. Elsewhere counts from the scheduled pickup; an airport counts from the landing time, or from the pickup when the landing time is empty. A landing or airport-mark change committed before the lock is what the attempt uses. Early office is `ride.no_show_early` and a No-show after the wait is `ride.no_show`; the actor is `actor_user_id` and shown as the who column. The update sets only `state`. Upcoming rides stay `assigned` or `accepted`, so a No-show leaves that list. Existing commands already refuse `no-show`, and a second No-show is refused. A refusal throws before the update and writes no audit row. Driver and day-list copy exist in Croatian and English, and both screens use theme-aware components.

**(b) Scope creep**
None. Empty-body rejection, cross-tenant 404, and no mail match the existing Ride commands. ADR-0026 already says a No-show sends nothing. Wait lengths on the upcoming list only drive the Driver button.

**(c) Implemented but wrong**
None. `noShowWaitElapsed` uses the Tenant settings read inside the attempt, and the Driver is allowed at the elapsed instant (`>=`), which is what “refused before the wait has elapsed” requires. An office mark after the wait shares `ride.no_show` with the Driver; the distinct action is only the early office case, and the actor still names who did it.
