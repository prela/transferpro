# 26 Correct a Transfer

Out of scope: the correction work-order email (#168), the office slideover (#197), and an expected-arrival column.

## Decisions

- `PATCH /api/transfers/:id` is office only. A dispatcher or an admin corrects an unfinished Transfer. A driver is 403 and the row is unchanged. The body is the create-Transfer body. A bad id or body is 400 before a session opens. Another Tenant is 404. `done`, `no-show`, and `cancelled` are 409 `transfer_closed` before catalogs load, and the stored booking stays. An archived start or end is 409 `location_archived`.
- Pickup time, start, end, and the stored flight-number text are the trip. Changing any of them on an `accepted` Ride returns it to `assigned` and keeps the Driver, the Vehicle, and the copied flag. The same change on an `assigned` Ride leaves it `assigned`. A save that does not change those four values leaves an `accepted` Ride `accepted`. Client, passenger count, guest name, price, payment, airport mark, luggage, child seats, note, and tabla do not return the Ride.
- The phone alert is the existing upcoming line for `assigned` plus the copied flag. There is no new alert kind and no SMS. Decline after the return uses the existing decline command.
- A different flight designator clears `landing_at` in the same change. Spacing of the same designator does not. A note that stays a note does not. `VIP 2` is a designator. There is no expected-arrival column.
- A save that changes nothing writes no audit row. Otherwise append `transfer.corrected` with `transferId`, `rideId`, `clientId`, `startLocationId`, `endLocationId`, and the changed field names. No guest, flight text, note, tabla, or price. `subjectUserId` stays null. When the Ride returns and a Driver is set, also append `ride.returned_to_assigned` with `rideId`, `driverId`, and `fields: ['state']`. The actor is the office member.
- This command sends no mail. That mail is #168.

## Code review

Reviewed the uncommitted working tree against `origin/develop` (`git diff origin/develop`, plus the untracked command, route, migration, and e2e spec). No commits at review time. After this review, a note that stays a note no longer clears `landing_at`. The review example `VIP` to `VIP 2` still clears, because `VIP 2` is a designator.

## Standards

**Hard.** `server/modules/transfers/infrastructure/correct.ts` (`correctTransferForOffice`) and `server/modules/transfers/index.ts` save a correction and, when the trip changes, set the Ride back to `assigned`, then return. Both comments say no mail is sent. That contradicts ADR-0026: after a save, a real change of pickup, place, flight, guest, counts, airport mark, tabla, note, client, payment, or cash price is a `changed` work order, and “a change that returns an accepted Ride to assigned still uses changed.” A Ride with no Driver sends nothing; one with a Driver must. ADR-0010’s “The Driver is alerted” is the same gap. ADR-0028 keeps that rule for everything except a landing-time change.

Checked and aligned: new actions have a Zod shape, an `audit_entry_shape` branch, migration `0034` (journal `when` is the previous entry plus 1000), and `audit.actions.*` in both locales (`docs/agents/working-rules.md`, Audit log). Appends run on the tenant transaction with ids and field names only (ADR-0014; glossary Audit entry). The route parses with Zod before `withTenantFromSession`, and `officeOnly` allows only admin and dispatcher (AGENTS.md). Clients and Locations are reached through each module `index.ts` (ADR-0018). Both locales, Nuxt UI controls, and `e2e/correct-transfer.spec.ts` (Croatian flow, English smoke, both themes) are present. ADR-0029 still leaves a pickup clash for a later ticket. ADR-0028’s designator rule clears `landing_at` only; there is no expected-arrival column yet.

**Judgement — Duplicated Code.** `requireLiveBooking` repeats the catalog check already in `recordTransfer`:

```161:170:server/modules/transfers/infrastructure/correct.ts
async function requireLiveBooking(...) {
  const client = (await loadClients(transaction)).find(row => row.id === input.clientId)
  // ... loadLocation, refuse archived start and end
}
```

`loadClient` is already on the clients module.

**Judgement — Speculative Generality.** `correctTransferForOffice` is exported, but only `correctTransfer` calls it and the module `index.ts` does not re-export it.

## Spec

### (a) Missing or partial
None. Soft edits (Client, passenger count, guest name, price, payment, airport mark) leave an accepted Ride accepted. A change of pickup time, start, end, or flight number moves it to assigned and does not rewrite the Driver, Vehicle, or copied flag. The upcoming list then shows assigned plus the existing waiting copy. `ride.returned_to_assigned` stores the office actor. Decline still works, and the existing decline alert names the Driver. The same trip change on an assigned Ride leaves it assigned. A save that does not change those four values leaves an accepted Ride accepted. Cash and card follow the existing phone price rule and do not move the Ride. Done, no-show, and cancelled return 409 with the booking unchanged. A driver gets 403. An airport-mark change appends `transfer.corrected`. A refused edit appends no transition. New copy is in Croatian and English, and the day list uses the existing light and dark theme.

### (b) Scope creep
None. The day-list form still saves luggage, child seats, note, and tabla; the brief allows that form. No correction mail is sent.

### (c) Implemented but wrong
"A different flight designator clears landing_at; spacing-only same designator does not clear landing but is still a stored-text change."

`flightNumberChangeClearsLanding` nulls `landing_at` for every stored-text change that is not the same designator. A note changed to another note (`VIP` to `VIP 2`) is not a designator change, and it still clears the landing. Spacing of the same designator is handled correctly and still returns an accepted Ride to assigned.
