# 24 Decline an assigned Ride

Out of scope: no-show, cancel, correcting a Transfer, the warning job (#29), decline again after a material change (#26), and mail.

## Decisions

- `POST /api/rides/:id/decline` is the Driver who holds the Ride. The body is empty. Any key is 400 before a session opens. A dispatcher or an admin is 403.
- `canDeclineRide` is true only for `assigned`. From `accepted`, and from `done`, `no-show`, or `cancelled` while that Driver still holds the Ride, the answer is 409 `ride_not_declinable`. A Ride the Driver does not hold, or one with no Vehicle, is 404. A refusal writes no audit row and no decline alert.
- The update runs only while the Ride is `assigned` to that Driver. It sets `unassigned` and clears the Driver, the Vehicle, and the copied flag together.
- The audit action is `ride.declined`. Data is the Ride id, the Driver id, the Vehicle id that was cleared, and the field names `state`, `driverId`, `vehicleId`, and `mustAccept`. The actor is the Driver. It does not store a name, a phone, a plate, a guest, or the must-accept value. The log joins the Driver name and the plate.
- The decline alert is written in that same transaction. The day list returns it for the Ride's operational day and joins the Driver name and the guest when it is read. The stored row keeps ids and the kind `declined`. There is no update or delete grant. At once means the next day-list read. The office home has no timer. Issue #29 still owns the warning job and the rest of the warning board.
- The alert sits above the day table. It does not replace the table. The returned Ride stays on the board.
- Decline sends no mail (ADR-0026). The upcoming list is `assigned` and `accepted`, so clearing the Driver drops the Ride.
- The Driver confirms first. Cancel writes nothing. A day change during the first load still applies the catalogs.

## Code review

Reviewed the uncommitted working tree against `origin/develop` (`git diff origin/develop`, plus the untracked command, route, table, and migration). No commits at review time. After the review, the day-list alert was taken off the `v-else` chain so the returned Ride stays visible, and `GLOSSARY.md` names **Decline alert**. No new ADR: ADR-0006 already says the Dispatcher is to be alerted and that the job is later. This ticket is that alert on the existing day board. The judgement calls below were left.

### Standards

**Hard breaches: yes.**

<<<<<<< HEAD
**ADR-0006 and `AGENTS.md` (“Do not contradict one; propose a new ADR”).** ADR-0006 leaves delivery open: “How the alert is delivered is the alerts work” and “The decline alert is a rule now and a job later.” This diff chooses a channel anyway: `app.ride_alert` (`db/ride-alert.ts`, `0032_ride_declined.sql`), `loadDeclineAlertsForDay` in `transfers.ts`, and the board banner in `TransferDay.vue`. No new ADR records that decision.
=======
**ADR-0006 and `AGENTS.md` (“Do not contradict one; propose a new ADR”).** ADR-0006 leaves delivery open: “How the alert is delivered is the alerts work” and “The decline alert is a rule now and a job later.” This ticket implements the day-board channel (`app.ride_alert`, `0031_ride_declined.sql`, board banner) for the “alert now”; #29 still owns the warning job. No new ADR.
>>>>>>> a2c7b38 (fix(e2e): named Decline buttons and hydrate day before landing-alarm board)

**`AGENTS.md` (“Update `GLOSSARY.md` … when a term … changes”).** `DeclineAlert` / `ride_alert` is a new stored concept, the same class as **Unassigned alarm** and **Landing alarm**. The glossary only extends **Audit entry**. The alert itself is unnamed.

RLS on `ride_alert` matches the security rules (tenant id from the session, `FORCE ROW LEVEL SECURITY`, `tenant_isolation`, `REVOKE ALL`, no `DELETE`). `ride.declined` has the four audit pieces in `docs/agents/working-rules.md`. The route checks the driver role itself. Both locales and an `e2e/` spec are present. ADR-0026 (decline sends no mail) holds. The SQL check and `rideChangeFieldsArray` both require the four assignment field names.

#### Judgement calls

**Speculative Generality.** `kind` exists only so a later alert can widen a check:

```7:12:db/ride-alert.ts
 * Kind is a check, not an enum, so a later alert is a constraint change.
```

v1 has one value, `'declined'`.

**Duplicated Code.** `confirmDecline` / `declineOpen` in `DriverRides.vue` repeat the mark-done dialog (pending flag, 409/404 reload, modal). The same `delete from app.ride_alert where tenant_id …` is copied into four RLS `beforeAll`s.

**Middle Man.** `canDecline` only forwards:

```121:123:app/components/DriverRides.vue
function canDecline(ride: DriverUpcomingRide): boolean {
  return canDeclineRide(ride.state)
}
```

### Spec

#### (a) Missing or partial

None. Decline from `assigned` returns the Ride to `unassigned` and clears the Driver, the Vehicle, and the copied flag. The upcoming list reloads and drops the Ride. `accepted` is `409` with no audit row and no alert. The audit row stores that Driver’s id and the screen joins the name. Copy is in both locales; the new screens follow the existing light and dark theme. No work-order mail is sent.

#### (b) Scope creep

`loadAll` in `TransferDay.vue` now applies catalogs even when that load is stale. Nothing in “Decline an assigned Ride” asks for a change to catalog loading.

The board sentence is `{driver} declined the ride for {guest}.` The spec only asks for an alert “that names the Driver who declined.”

#### (c) Implemented but wrong

None after the review fix. The alert sits above the day table; the returned Ride stays on the board. Decline clears the Driver, the Vehicle, and the copied `mustAccept` flag — not the meet-sign `tabla`, and not the day board itself.

**ADR-0006 alert storage.** ADR-0006 leaves delivery open (“alert is a rule now and a job later”). This ticket uses `app.ride_alert` for the day-board banner only; issue #29 still owns the warning job. No new ADR.
