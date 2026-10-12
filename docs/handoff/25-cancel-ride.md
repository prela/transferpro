# 25 Cancel a Ride

Out of scope: the cancel work-order email (#169), no-show, decline, and correcting a Transfer.

## Decisions

- `POST /api/rides/:id/cancel` is office only. A dispatcher or an admin cancels any Ride in the Tenant. A driver is 403 and the Ride is unchanged. The body is empty. Any key is 400 before a session opens.
- Cancel is allowed from `unassigned`, `assigned`, and `accepted`. `done`, `no-show`, and a second cancel are 409 `ride_not_cancellable`. A refusal writes no row and no audit entry. The Driver, the Vehicle, and the copied flag stay, including when there is no Driver.
- The audit action is `ride.cancelled`. The actor is the office member. Data is `rideId`, `driverId` (null when the Ride was unassigned), and `fields: ['state']`. The screen joins the Driver name when the id is present and does not join the plate.
- Cancel sends no mail. That mail is #169.
- The day list confirms before the post. Dismiss writes nothing. The command copy is `ride.cancelRide*`. `ride.cancel` stays the dialog dismiss label.

## Code review

Reviewed the uncommitted working tree against `origin/develop` (`git diff origin/develop`, plus the untracked command, route, and migration). No commits at review time. The judgement calls below were left.

### Standards

No documented-standard breaches.

Audit, RLS, states, and mail match the sources. `ride.cancelled` has the four required pieces: `auditActions` plus a strict shape (`shared/audit-entry.ts`), an `audit_entry_shape` branch (`db/audit-entry.ts`), migration `0031_ride_cancelled.sql`, and `audit.actions.cancelled` in both locales (`docs/agents/working-rules.md`, Audit log). The journal `when` is the previous value plus 1000 (`1791400021000`). The append runs in the same transaction as the update, stores the Ride id, the Driver id or null, and `fields: ['state']`, and stores no name, phone, plate, or guest (`GLOSSARY.md` Audit entry; ADR-0014). Cancel is office-only, from `unassigned`, `assigned`, or `accepted`, and terminal states stay terminal (ADR-0005). `cancel.ts` does not send mail (ADR-0026 is deferred to #169). Both locales and Nuxt UI tokens are present (`docs/agents/working-rules.md`, i18n and theme). The route parses with Zod and the command checks `admin` or `dispatcher` before returning a Ride (`AGENTS.md`).

**Judgement calls**

- **Duplicated Code** — `app/components/TransferDay.vue`. The new cancel dialog repeats the mark-done machine already in that file (`open` / `close` / open computed / failure key / confirm, plus the modal). Example: `function openCancelRide(ride: TransferDayRide) { if (!canCallOff(ride) || cancelPending.value) return; … cancelling.value = { rideId: ride.rideId, guestName: ride.guestName } }`. The file already copies this per command, so this follows a local pattern rather than a written rule.
- **Mysterious Name** — same file. `function canCallOff(ride: TransferDayRide): boolean { return canCancelRide(ride.state) }`. The route, schema, glossary, and copy say cancel. ADR-0005 uses “called off” only in prose. The comment says the Driver cannot cancel, but the function only checks state. The role ban lives in `cancelRide`.

### Spec

#### (a) Missing or partial

None. Dispatcher and admin cancel from `unassigned`, `assigned`, and `accepted`; the row stays `cancelled` with no delete grant; it drops off the Driver upcoming list (`assigned`/`accepted` only); assign, accept, accept-by-phone, done, clear, vehicle change, reassign, and a second cancel are refused; a driver gets 403 and the row is unchanged; a refused cancel writes no audit row; the audit who-column is the actor; day-list copy is in `en` and `hr`, and the screen test runs light then dark. “A trip that is still on is entered as a new Transfer” is the do-not-revive rule: this change does not insert a replacement Ride, and the existing create-Transfer form remains.

#### (b) Scope creep

None. No cancel mail is #169, not extra behaviour here.

#### (c) Implemented but wrong

None.
