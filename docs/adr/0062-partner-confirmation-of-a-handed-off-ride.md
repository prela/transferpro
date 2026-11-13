# Partner confirmation of a handed-off Ride

Status: accepted

The owner accepted this on 11 November 2026, in the grill of #548. It extends ADR-0048 and ADR-0046, and partially supersedes ADR-0024, ADR-0039, and ADR-0055; the sentences are named below. ADR-0005, ADR-0006, ADR-0008, ADR-0010, ADR-0023, ADR-0034, and ADR-0038 stand.

## Context

The owner decided that a Partner must confirm a Ride handed off to it, and that the office records that confirmation, with who recorded it and when. ADR-0048 has one state, `handed_off`, and a handoff is complete the moment the office records it. The board cannot tell which handoffs the Partner has not agreed to. A Partner has no login (ADR-0033), so only the office can record it. The nearest pattern is the Driver's: ADR-0006 puts must-accept on the Driver and blocks done and No-show until the Ride is accepted, and ADR-0008 lets the office record acceptance by phone, without a version in the body. ADR-0010 clears acceptance when the time or a place changes.

The words accept and confirm were already taken. Accepted is a Driver state with the rules above. Confirm, and `confirm: true` on a handoff, is the office passing an overlap or an unavailability (ADR-0029, ADR-0034).

The alternatives were a new state such as `handed_off_confirmed`; a confirmation time and member on the Ride row; deriving the confirmation from the audit log; a must-confirm setting on the Partner, copied to the Ride; an optional record that leaves an unconfirmed handoff unmarked; blocking done and No-show until the Partner confirmed; done that records the confirmation on the way; a withdraw action; showing who confirmed and when on the Ride detail; and an alarm for an unconfirmed handoff.

## Decision

### Language

A Partner confirmation (Potvrda podizvođača) is the office's record that the Partner agreed to run a handed-off Ride, after a call or a message outside Transferpro. The Partner never records it. A handed-off Ride without it is waiting on Partner confirmation (Čeka potvrdu podizvođača); with it, it is confirmed by the Partner (Podizvođač potvrdio). A Partner does not accept. In code and in a body, the name is never a bare `confirm`.

### Every handoff waits on it

Every handoff waits on a Partner confirmation. There is no setting on the Partner. Every Partner is an outside company with no login, so the own-driver case that must-accept exists for does not arise.

### Where it is stored

The Ride stores one flag, `partner_confirmed`, `boolean not null default false`. A check allows `true` only while the state is `handed_off`. The Ride states stay seven. Who recorded it and when live only in the audit entry, as the Ride stores no `assigned_at` or `assigned_by` (ADR-0014). Adding the column with a constant default rewrites no row and runs no `UPDATE`. A handed-off Ride that existed before it starts waiting on Partner confirmation.

### Recording it

A Dispatcher or an Admin records the Partner confirmation on a handed-off Ride waiting on it, behind a confirmation dialog, as with acceptance by phone. A Driver is refused.

The handoff and the change of Partner may record it in the same request, with `partnerConfirmed: true` in the body. That field is separate from `confirm`, which still passes an unavailable Partner. The dialogs offer "Podizvođač je već potvrdio" ("The subcontractor has already confirmed"), off by default, with "Uključite samo ako ste ovu vožnju već dogovorili s podizvođačem." ("Tick only if you have already agreed this ride with the subcontractor."). A refused handoff or change of Partner writes nothing, the confirmation included. A resend after 409 `ride_unavailable` keeps the box as it was.

### Version and refusals

Recording the Partner confirmation, on its own or with a handoff or a change of Partner, is an office data save and changes the ADR-0046 version once. Its body requires the version the form was opened with. That differs from acceptance by phone on purpose: without it, a Dispatcher whose colleague has just changed the Partner would record a confirmation for a Partner nobody called.

The refusals come in this order, and a test locks it: a body that fails, or has no version, is 400 before a session is opened; no session is 401; a Driver is 403; another Tenant's Ride, or no such Ride, is 404; a version mismatch is 409 `stale_save`; any Ride that is not a handoff waiting on Partner confirmation is 409 `ride_not_awaiting_partner_confirmation`. That last one covers a handoff already confirmed, a Ride taken back, a Ride never handed off, and a closed Ride. `transfer_closed` is not a step here. No refusal writes, appends an audit entry, or changes the version. There is no silent success: a second recording from the same form is `stale_save`, because the first changed the version.

### What it does not check

The Partner confirmation on its own takes no Tenant capacity lock, and capacity does not judge it, because it moves neither the Partner nor the window. With a handoff or a change of Partner, the lock and the judgement are those of that command, unchanged. It does not read the Partner row: a Ride whose Partner was archived after the handoff can still be confirmed, because the archived refusal of ADR-0049 guards new work, not the record of work already agreed. An unavailable Partner is not refused with `ride_unavailable`, and the unavailability warning stays on the Ride, derived on read.

### What clears it

A change of Partner, taking the Ride back, and closing it as done, a No-show, or cancelled clear it, because the Partner it was given for is gone.

A Transfer correction of a handed-off Ride clears it when it changes the pickup time, where it starts, where it ends, or the flight number, by the ADR-0010 rules (the spacing or case of the same designator does not), or the passenger count, the luggage count, or the child-seat count. The Partner sends the vehicle and its equipment, so the counts matter to it in a way they do not to a Driver. The route fields of ADR-0010 include the stops once ADR-0058 is built. Nothing else clears it: not the guest name, the tabla, the note, the Client, the Client reference, the price, the payment, the airport mark, the landing time, the expected arrival, the group's ordered passenger count, or an unavailability window over the Ride. A refused correction clears nothing. A correction applied to the extra vehicles (ADR-0054) judges each handed-off extra vehicle on its own.

A change of Partner, taking it back, and a correction already change the version. Closing does not, as no close does (ADR-0046, ADR-0048). Closing is the only transition that clears the Partner confirmation without changing the version. It is a state action, not a data save, and the flag goes with the Partner as a consequence of the end of the Ride. No save can rely on the cleared flag: a form that still holds the current version gets the state refusal, and an older form gets `stale_save`.

### Closing

The office may close a handed-off Ride as done, a No-show, or cancelled whether or not the Partner confirmed it. Closing does not record a confirmation. The office closes on the Partner's own report that the Ride is over, and a confirmation recorded only to pass a rule would make the audit less true. The unclosed mark of ADR-0055 is unchanged.

### Audit

`ride.partner_confirmed` holds the Ride id, the Partner id, and the field name `partnerConfirmed`. It is the same entry for a confirmation on its own and for one recorded with a handoff or a change of Partner; those write their own existing entry beside it, on the same transaction. The actor is the office member, and the time is the entry's. `ride.partner_confirmation_cleared` holds the same three and is written only when a correction clears a confirmation that was set; its actor is the member who corrected the Transfer, beside the unchanged `transfer.corrected`. A change of Partner, taking it back, and closing keep their existing entries unchanged and write no clearing entry. Neither new entry holds a name, a contact, a plate, a guest, or any free text. Both arrive in a migration, each with its own check of keys and field names. The audit screen calls them "Ured potvrdio u ime podizvođača" ("Office confirmed for the subcontractor") and "Potvrda podizvođača poništena ispravkom" ("Subcontractor confirmation cleared by a correction"), and joins no Partner name, as for the other handoff entries.

### Screens

On the Ride detail, a handoff waiting on Partner confirmation has "Zabilježi potvrdu podizvođača" ("Record subcontractor confirmation") as its primary action while its scheduled pickup is not in the past. Once it is, which is the edge in progress uses (ADR-0022), the primary action is done, and the confirmation moves to Više. The landing is not read. Live refresh moves it within 60 seconds (ADR-0039). The dialog says "Ovo bilježi da je podizvođač potvrdio vožnju telefonom ili porukom." ("This records that the subcontractor confirmed the ride by phone or message."), and its button is "Zabilježi potvrdu" ("Record confirmation"). A 409 `ride_not_awaiting_partner_confirmation` says "Ova vožnja više ne čeka potvrdu podizvođača."; `stale_save` offers the existing refresh. A confirmed handoff keeps done as its primary action. The Ride detail does not show who recorded the confirmation or when.

The state column shows a handed-off Ride as "Čeka potvrdu podizvođača" ("Awaiting subcontractor"), drawn as waiting on acceptance is, or "Podizvođač potvrdio" ("Subcontractor confirmed"), drawn as accepted is, always as icon, text, and colour (ADR-0040). The Partner's name stays where it is. "Predano podizvođaču" stays the name of the state in filters, the Home count, and the audit.

Home shows a list "Čeka potvrdu podizvođača" below "Čeka prihvat": every handoff waiting on Partner confirmation whose pickup is not in the past, of any day, soonest first, with "Zabilježi potvrdu" as its row action. The list is a display, not an alarm. Its rows carry no mark and no tier, are not in Pozornost, do not count toward the urgent count, and are not announced. A row leaves it once its pickup is in the past. The balance is unchanged: handed off stays one part, confirmed or not. The list opens Transfers with the URL filter `awaitingPartner`. The Transfers toolbar keeps its seven quick filters, and "Čeka prihvat" stays the Driver's.

A correction that clears a Partner confirmation says so beside its result: "Potvrda podizvođača je poništena jer su se promijenili vrijeme, mjesto, let ili broj putnika, prtljage ili sjedalica. Javite promjenu podizvođaču i ponovno zabilježite potvrdu." ("The subcontractor confirmation was cleared because the time, a place, the flight, or a passenger, luggage, or child-seat count changed. Tell the subcontractor and record the confirmation again."). A correction applied to a group shows one notice with the number of Rides that lost it, in the Croatian plural forms: "na 1 vožnji", "na 3 vožnje", "na 5 vožnji".

### Left as they are, on purpose

The CSV export and the Ride history of a Client and of a Partner keep the plain state word. The day print shows no state. The Driver's phone never shows a handed-off Ride, and no mail goes to a Partner (ADR-0048).

### Out of scope

An alarm for a Ride nobody has confirmed, for a Partner and for a Driver alike, is decided later in its own grill, together; see the comment "Pending grills (b)" on #206. ADR-0023 stands: waiting on acceptance has no hour limit and takes no alarm, and neither does waiting on Partner confirmation.

## Consequences

The board and Home tell a handoff the office still has to call about from one that is agreed. A Partner that always takes the Ride is confirmed in the handoff step, so it is never left waiting. The audit log shows which office member recorded each confirmation, and when, on the Partner's behalf.

A Dispatcher cannot see who recorded a confirmation, because the audit screen is Admin only. A narrow office read of the last `ride.partner_confirmed` of one Ride, returning only the member's name and the time, with its own role allow-list and RLS tests, can show "Potvrdio: ime, vrijeme" after the pilot, with no migration.

There is no action to withdraw a confirmation. A Partner that withdraws is handled by a change of Partner or by taking the Ride back. A wrong click is undone the same way; a new handoff after a take-back is judged by capacity again and changes the version twice. A withdraw action can be added after the pilot with no migration.

A change to the note, the tabla, or the guest does not clear a confirmation. The office judges whether to tell the Partner.

A closed Ride no longer holds the flag; only the audit log keeps that it was confirmed.

ADR-0038 and ADR-0039 still speak of eight counts, although ADR-0048 added the handed-off count. This record changes no count and leaves that mismatch as it stands.

Accepting by phone still takes no version and no Driver id, so after a reassignment the office could record acceptance for a Driver it did not call. This record does not change that.

### Superseded

In ADR-0024: "We will return the three lists and the seven counts from one office read, taken at one moment." and "The lists are every unfinished unassigned Ride, every Ride waiting on acceptance, and every Ride in progress." Home also shows the handoffs waiting on Partner confirmation whose pickup is not past, from the same read, at the same moment.

In ADR-0039: "The three lists and the eight counts still come from one read taken at one moment." The lists, now four on Home with the one above, and the counts still come from one read taken at one moment.

In ADR-0055: "A handed-off Ride is a count and not a row until that instant, then shows in Pozornost." A handed-off Ride waiting on Partner confirmation is also a row on "Čeka potvrdu podizvođača" while its pickup is not past. Otherwise it is still a count until that instant, then shows in Pozornost.
