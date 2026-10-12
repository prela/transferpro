# 175 Expected arrival

Out of scope: the mail wording, the will-not-arrive notice (#176), and a flight-status vendor.

## Decisions

- `expected_arrival_at` is the current estimate. `expected_arrival_basis_at` is the last estimate the Driver was told, or the first stored estimate when the Driver has been told nothing. The first store sets both and tells nobody. A later value is stored even when the change is under 15 minutes, and the basis stays.
- A movement is at least 15 minutes from that basis, earlier or later. With a Driver, the ask calls `Mailer.notifyArrivalMoved` with the Ride id, the Driver id, and the previous and new instants, then sets the basis to the new instant. With no Driver, the movement is stored, the basis stays, and the port is not called. The next ask after a Driver is assigned hands that movement once. The same instant does not hand it again.
- The Ride state is not updated. A different flight designator clears both columns in the same write that clears `landing_at`.
- The message text is not this ticket. `notifyArrivalMoved` is a method on the existing mailer. The Resend adapter accepts the fact and sends nothing. The wording ticket fills that method. Do not add a channel.
- A cancelled or diverted flight, and an arrival at another airport, are #176. This ask does not clear the estimate and does not send that notice.

## Code review

## Standards

**Hard.** `shared/flight-landing.ts` and `server/modules/transfers/infrastructure/flight-landing.ts` contradict ADR-0028 and `AGENTS.md` (“Do not contradict one; propose a new ADR”). ADR-0028 requires that a cancelled flight, or one arriving at another airport, clears the expected arrival, writes no landing time, and notifies the assigned Driver. `chooseFlightArrival` returns `{ kind: 'elsewhere' }` or `{ kind: 'none' }` instead, and the comment says “Cancelled and diverted are a later notice.” `refreshFlightLandings` writes only when `reported !== null`, so a cancel leaves the stored estimate and logs `landing-unchanged`. `shared/flight-landing.test.ts` locks that in: a cancelled status expects `{ kind: 'none' }`.

**Hard.** `createResendMailer` in `server/modules/tenancy/infrastructure/mailer.ts` does not notify. ADR-0028: “We notify the assigned Driver through the ADR-0026 port only.” ADR-0026: the v1 adapter is this mailer, and the send reads the Driver email. The new method is `async notifyArrivalMoved() {}` under “The message text is a later ticket. The fact is accepted and no mail is sent.” `ArrivalMovedNotice` has `rideId`, `driverId`, `previous`, and `next`, and no recipient, so the production adapter cannot send.

**Judgement — Mysterious Name.** `ArrivalMovedNotice.previous` and `.next` do not say they are expected-arrival instants:

```ts
export interface ArrivalMovedNotice {
  readonly rideId: string
  readonly driverId: string
  readonly previous: string
  readonly next: string
}
```

**Judgement — Duplicated Code.** The same empty stub is copied onto every `Mailer` fake in the diff (`async notifyArrivalMoved() {}` in `server/api/rides.rls.test.ts`, `invitation.rls.test.ts`, `invite-send.test.ts`, and `flight-landing-worker.test.ts`). One shared double would do.

No other documented breach. The migration’s `when` is the previous entry plus 1000 (`working-rules.md`). The new columns sit on an existing tenant table; `transfer.rls.test.ts` shows Tenant B cannot read or write them. Imports stay on `tenancy`’s `index.ts`. Both locales ship. Instants stay `timestamptz` and the day board uses `formatInstant`. Logs carry `rideId` and `driverId`, not the instants or an address. Threading the column through the existing landing read models matches that shape, so it is not shotgun surgery.

## Spec

No missing, extra, or incorrect behaviour against issue #175. ADR-0028’s will-not-arrive notice is left to #176.

**(a) Missing or partial.** None. Each acceptance line is in the diff: every reported estimate is stored, including a shift under 15 minutes; the office Ride (home and day list) and the Driver’s Ride show it when present, in the Tenant zone, in Croatian and English, with theme-inherited text; the first stored value notifies nobody; a later value is handed to the port only when it differs by at least 15 minutes from the basis (the last instant the Driver was told, or the first stored instant when the Driver has been told nothing); 14 minutes does not call the port and exactly 15 minutes does, earlier or later; the fact carries the previous instant and the new instant; a Ride with no Driver stores the movement and does not call the port; the next ask after a Driver is assigned hands that stored movement once, and a later ask of the same instant does not; the Ride is not moved off accepted; Tenant B cannot read or write Tenant A’s expected arrival. Mail wording is not written: the Resend adapter accepts the fact and sends nothing.

**(b) Scope creep.** None. Clearing the expected arrival and its basis when the flight designator changes is ADR-0028 (“Changing the flight number to a different designator clears the expected arrival and the landing time”), which the issue adopts. A spacing-only edit clears nothing. `notifyArrivalMoved` is a method on the existing mailer, not a new channel.

**(c) Implemented but wrong.** None. The basis stays on the last told instant, or the first stored instant, across smaller changes, so a later ask is measured against that instant rather than against the last un-notified value.
