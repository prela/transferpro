# 176 Will not arrive

Out of scope: the mail wording, a flight-status vendor, and any change to the No-show clock or the unclosed mark.

## Decisions

- A cancelled status, a diverted status, or an arrival at another airport is `{ kind: 'will-not-arrive' }` only when that row is the unique closest arrival within 6 hours and it has an instant. A tie, an empty list, or no instant writes nothing and tells nobody.
- `flight_will_not_arrive` stores the fact. `flight_will_not_arrive_handed` is true only after the port was called. The ask clears `expected_arrival_at` and `expected_arrival_basis_at` and does not write `landing_at`. The Ride state stays as it was.
- The port method is `Mailer.notifyFlightWillNotArrive` with the Ride id and the Driver id. It is not `notifyArrivalMoved`. The Resend adapter accepts the fact and sends nothing. Do not add a channel.
- With no Driver the fact is stored and the port is not called. The next ask after a Driver is assigned hands it once and does not call the status port. `app.tenants_due_flight_landing` keeps an unhanded row due and drops a handed row.
- A different flight designator clears both flags in the same write that clears the landing time and the expected arrival.

## Code review

## Standards

No hard breaches of `AGENTS.md`, `docs/agents/working-rules.md`, ADR-0018, ADR-0028, or `GLOSSARY.md`.

`0036_flight_will_not_arrive.sql` (untracked; journal `when` is previous + 1000) replaces `app.tenants_due_flight_landing` as `SECURITY DEFINER`, `search_path = pg_catalog, pg_temp`, returning tenant ids only, and stops asking once `flight_will_not_arrive_handed` is true. That matches ADR-0028. `CREATE OR REPLACE` keeps the existing `EXECUTE` grant to `transferpro_app`. New columns sit on `app.transfers`, which already has `tenant_id` and RLS. The ask logs `rideId` and `outcome` only. `GLOSSARY.md` extends **Expected arrival** with the will-not-arrive fact. Transfers still take `Mailer` from `server/modules/tenancy/index.ts`.

### Judgement

**Duplicated Code.** The same empty method is pasted onto every inline `Mailer`:

```ts
async notifyFlightWillNotArrive() {},
```

in `server/api/rides.rls.test.ts` (twelve times), `invite-send.test.ts` (four), `invitation.rls.test.ts`, and `flight-landing-worker.test.ts`. One shared double would cover them. `createFakeMailer` already records the notice; these stubs do not.

**Mysterious Name.** `hand` does not say what it does next to `handed`:

```ts
export interface WillNotArriveUpdate {
  readonly observed: true
  readonly handed: boolean
  readonly hand: boolean
}
```

`shared/flight-landing.ts`. `hand` means “call the port this ask.”

## Spec

### (a) Missing or partial

The acceptance lines are present: clear the expected arrival, write no landing time, hand `will not arrive here` (not moved), once per designator, store-and-skip with no Driver, hand once on the next ask after assignment, skip the status port after that, leave an empty result alone, and leave the No-show clock and the unclosed mark untouched. A designator change clears both new flags with the landing time and the expected arrival in `correct.ts`.

### (b) Scope creep

None. The mailer method, the two flags, and the due-function change are the port and the “at most once / next ask” memory. Resend still sends no wording.

### (c) Implemented but wrong

**A cancelled or diverted status is recognized only when that row is the unique closest arrival inside 6 hours and has an instant.** `arrivalInstant` drops a non-landed row whose estimate is null, and a tie returns `{ kind: 'tie' }` before the status check. Both become `{ kind: 'none' }`. `refreshFlightLandings` then leaves the stored expected arrival and does not call the port. The same happens when the only time is more than 6 hours from pickup.

> “When the live status says the flight is cancelled, or that it will arrive at an airport other than the pickup Location's IATA code, the expected arrival is cleared and the assigned Driver is told… that the flight will not arrive here.”

> “a cancelled status, or a diverted status, clears the expected arrival, does not write a landing time… An empty status result is not a cancellation.”

A list that contains a cancellation with no usable time is not an empty result. ADR-0028’s “Otherwise we write nothing” covers a non-matching instance; it does not cover a cancelled row that never enters the ranking.

**The hand is recorded before the port is called.** `writeWillNotArrive` sets `flight_will_not_arrive_handed` first. If `notifyFlightWillNotArrive` throws, the next ask sees the flag, does not call the port, and the due function can drop the Tenant.

> “The next ask after a Driver is assigned hands that stored fact once.”
