# 23 Mark a Ride done

Out of scope: no-show, decline, cancel, and correcting a Transfer.

## Decisions

- `POST /api/rides/:id/done` is one route. A driver marks only the Ride they hold. A dispatcher or an admin marks any Ride in the Tenant. The body is empty. Any key is 400 before a session opens.
- The copied flag decides the state. Off: `assigned`. On: `accepted` only, whether the Driver or the office recorded that acceptance. Anything else, including `unassigned` and a second done, is 409 `ride_not_finishable` for the office, and for a Driver who still holds the Ride. A Ride the Driver does not hold is 404. A refusal writes no row and no audit entry.
- `canMarkRideDone` is the rule. The update repeats it in SQL so a concurrent command loses. The Driver, the Vehicle, and the copied flag stay.
- The audit action is `ride.done` for both the Driver and the office. The actor is the person who marked it done. Data is `rideId`, `driverId`, and `fields: ['state']`. The screen joins the Driver name and does not join the plate.
- Done sends no mail (ADR-0026). The Ride leaves the Driver upcoming list because that list is only `assigned` and `accepted`.
- Both screens confirm before the post. Cancel writes nothing.

## Code review

Reviewed the uncommitted working tree against `origin/develop` (`git diff origin/develop`, plus the untracked command, route, and migration). No commits at review time. After the review, the glossary sentence that a done row does not store a name, a phone, a plate, a guest, or the must-accept value was added. The judgement calls below were left.

### Standards

No hard breaches. `ride.done` has the four audit pieces (`shared/audit-entry.ts`, `db/audit-entry.ts`, `0030_ride_done.sql`, both locales) required by `docs/agents/working-rules.md` (Audit log). The route parses with Zod before `withTenantFromSession`, and `markRideDone` allow-lists driver, dispatcher, and admin (`AGENTS.md` Security). The entry stores `rideId`, `driverId`, and `fields: ['state']` only. The journal `when` is the previous value plus 1000. The flag rule matches ADR-0006; ADR-0026 says done sends no mail, and this path does not. Shotgun edits across audit, UI, and tests are what those rules require, so that smell is suppressed.

#### Judgement calls

**Duplicated Code.** `DriverRides.vue` and `TransferDay.vue` repeat the same confirm flow (`markingDone`, `openMarkDone`, `closeMarkDone`, `markDoneOpen`, `confirmMarkDone`, and the same `UModal`). In `done.ts`, `markOwnRideDone` and `markRideDoneForOffice` share lock, `canMarkRideDone`, `writeDoneRide`, and `appendDone`. The SQL repeats the TypeScript rule:

```136:137:shared/transfer.ts
  return (state === 'assigned' && mustAccept === false) || (state === 'accepted' && mustAccept === true)
```

```186:188:server/modules/transfers/infrastructure/done.ts
        (state = 'assigned' and must_accept is false)
        or (state = 'accepted' and must_accept is true)
```

**Mysterious Name.** Both screens wrap that predicate as `canFinish`. Done audit data is built from the acceptance constant: `fields: [...RIDE_ACCEPTED_FIELDS]` in `done.ts`, and the `ride.done` check calls `rideAcceptedFieldsArray` in `db/audit-entry.ts`.

**Divergent Change.** The office done flow is appended to `e2e/day-list-accept-by-phone.spec.ts`.

**Glossary gap** (not a code breach). `GLOSSARY.md` Audit entry now says a done row stores the Ride id, the Driver id, and `state`, but unlike acceptance it never says a name, phone, plate, guest, or must-accept value is absent (`AGENTS.md`: update the glossary when a decision changes).

### Spec

No findings.

**(a) Missing or partial.** None. The copied-flag rule is in `canMarkRideDone` and the `done` update: off from `assigned`, on only from `accepted` (Driver accept and office accept-by-phone both land in `accepted`). `unassigned` and `assigned` with the flag on are refused and not updated. Upcoming rides stay `assigned` or `accepted`, so a `done` Ride drops off. `ride.done` stores `actorUserId`; the log’s who column is that member. A second `done`, accept, vehicle change, clear, and reassign all require a non-terminal state, so a `done` Ride stays `done`. A refusal returns before the update and writes no audit row. Day-list and driver screens use the Croatian and English strings and the shared light/dark theme.

**(b) Scope creep.** None. The empty body, the 404 when the Driver does not hold the Ride, the confirm dialog, and no mail are the same command shape as accept, or ADR-0026 (“done … send nothing”).

**(c) Implemented but wrong.** None.
