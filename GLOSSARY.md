# Transferpro

Dispatch for a transfer company: take a booking, assign the Ride, and record how it ended.

## Language

**Tenant**:
A transfer company using Transferpro. The company and its Better Auth organization are the same Tenant. In Croatian it is Tvrtka, and in the English UI it is Company.
_Avoid_: organization, firm

**Transfer**:
The booking. It names the Client, the pickup time, the start and end Locations, the passenger count, the guest name, an optional flight number, a price in EUR, the payment (`cash`, `card`, or `invoice_to_agency`), whether the pickup is an airport, the luggage count, the child-seat count, an optional note, and an optional tabla. The tabla is the words on the meet sign for this pickup. It is text on the Transfer, not on the Client. A blank is stored as empty text. There is no image. Creating a Transfer creates one Ride in `unassigned`. The airport mark is stored as entered and is not inferred from the flight number. `invoice_to_agency` is a recorded choice. The Driver sees the price and the payment method only for cash; card and invoice to agency hide both (ADR-0009, extended by ADR-0020), and so does an extra vehicle (ADR-0054). That phone rule is not on the office screen. The Transfer is the order: there is no separate Order above it. It has a Channel and an ExternalRef, and may carry a Client reference. In Croatian it is Transfer.
_Avoid_: Ride, job, order, rezervacija, narudžba

**Ride**:
The execution of a Transfer. One Transfer may have several Rides when the same journey is split across several Vehicles. A return journey is its own Transfer, not a second Ride. In v1 it has exactly one, created with the Transfer. A Ride is not deleted. In Croatian it is Vožnja.
_Avoid_: trip, job, leg

**Price**:
What the Client is charged for one Transfer, in EUR, VAT included. It is never what a Partner is paid; that cost is not in v1. In Croatian it is Cijena.
_Avoid_: cost, fare, rate

**Main Transfer**:
The Transfer that carries the Price of a group. It is invoiced once for the whole group. In Croatian it is Glavni transfer.
_Avoid_: lead, parent, first Transfer

**Extra vehicle**:
A Transfer linked to one main Transfer when one Vehicle cannot carry the whole booking. Its Price is 0, it is never invoiced, and it keeps its own Ride, Driver, and passenger count. In Croatian it is Dodatno vozilo.
_Avoid_: second Ride, leg, split, duplicate

**Group**:
A main Transfer and its extra vehicles. Its passenger count is the sum of theirs, leaving out a cancelled Ride. In Croatian it is Grupa.
_Avoid_: group booking, Order

**Transfer duration**:
The minutes a Ride occupies after its pickup, or after its landing when a landing is stored. The Tenant's default is 60. It is not a No-show wait.

**Relocation gap**:
The minutes the office wants between the end of one occupied Ride and the pickup of the next for the same Driver or the same Vehicle. The Tenant's default is 15. A shorter gap warns. It does not block. A gap of exactly that length is not a warning.

**Unassigned**:
A Ride with no Driver, no Vehicle, and no Partner.

**Unassigned alarm**:
An unfinished unassigned Ride during the four hours before its pickup. It is not an acceptance deadline.
_Avoid_: acceptance deadline

**Unassigned past pickup**:
An unfinished unassigned Ride once its pickup is in the past. It is urgent and sends nothing.
_Avoid_: missed pickup, no-show, overdue

**Urgent**:
The tier of what asks the office to act now: an unassigned past pickup, an unassigned alarm, a decline alert, a landing alarm, or an unclosed mark. It cannot be acknowledged or snoozed; it ends when its cause ends. In Croatian it is Hitno.
_Avoid_: notification, critical

**Warning**:
The tier of an overlap warning, an unavailability warning, fully booked, a roster mismatch, an expired-document warning, an unsent invoice, a failed invoice, or the payment-reporting reminder. It does not block and asks for no action now. In Croatian it is Upozorenje.
_Avoid_: alarm, urgent

**Assigned**:
A Ride with both a Driver and a Vehicle. When it requires acceptance, it is waiting on acceptance, including after an earlier acceptance was cleared. Whether it requires acceptance is copied from the Driver at assignment and stays on the Ride. The Vehicle on a new assignment starts as that Driver's roster Vehicle for the calendar day, and the office can still choose a different Vehicle for that one Ride. A roster change does not change a Ride already assigned. An assigned Ride occupies its Driver and its Vehicle for the transfer duration, including when it is in progress. A true overlap, or an unavailable Driver or Vehicle, blocks assign, a vehicle change, a reassignment, and a Transfer correction that moves when the Ride starts or ends, until the office confirms. A fully booked window blocks all of them except the Transfer correction, and confirming does not pass it; a correction saves with a fully booked warning. Clear does not.
_Avoid_: pending

**Waiting on acceptance**:
An assigned Ride that requires acceptance, at any pickup time, until it is accepted or cancelled, or the Driver declines it back to unassigned.
_Avoid_: pending

**Decline alert**:
The board's notice that a Driver declined an assigned Ride, naming that Driver.
_Avoid_: warning, unassigned alarm

**Accepted**:
A Ride that requires acceptance and has been accepted, by its Driver or by the office after confirming with that Driver by phone. Changing the pickup time, where it starts, where it ends, or the flight number returns it to assigned. Spacing or case of the same flight designator does not. Changing only the Vehicle does not.
_Avoid_: confirmed (as a separate state)

**Done**:
A finished Ride that was carried out.
_Avoid_: complete, closed

**No-show**:
A finished Ride the guest did not take. The Driver marks it after the Tenant's wait. The office may mark it earlier from the same source state, and marks a handed-off Ride at any time. v1 records it and charges nothing.
_Avoid_: cancellation

**Airport wait**:
The minutes a Driver waits at an airport pickup before a No-show. A new Tenant starts at 90. An admin can change it. The length is read when a No-show is attempted and is not stored on the Ride.
_Avoid_: grace period

**Elsewhere wait**:
The minutes a Driver waits at a pickup that is not an airport before a No-show. A new Tenant starts at 25. An admin can change it. The length is read when a No-show is attempted and is not stored on the Ride.
_Avoid_: grace period

**Cancelled**:
A finished Ride that will not run. It stays on record.
_Avoid_: deleted

**Handed off**:
A Ride the office has given to a Partner. It has no Driver and no Vehicle, and the office closes it. The office can change the Partner or take it back to unassigned. In Croatian it is Predano podizvođaču.
_Avoid_: assigned, outsourced

**In progress**:
A Ride that has a Driver, is not finished, and is not waiting on acceptance, once its pickup is in the past. An earlier day's pickup stays in progress until the Ride is done, a no-show, or cancelled.
_Avoid_: started, a Ride state

**Unclosed mark**:
An in-progress Ride, or a handed-off Ride, once 60 minutes have passed since its scheduled pickup. Both use the same minutes. A recorded landing does not move that instant.
_Avoid_: warning, unassigned alarm, overdue

**Landing alarm**:
An in-progress Ride with a stored landing time, once 60 minutes have passed after that landing plus the transfer duration. A Ride with no landing time does not take it. It sends nothing.
_Avoid_: unclosed mark, unassigned alarm, warning

**Operational-day start**:
The hour in the Tenant's time zone at which an operational day begins. A new Tenant starts at 05:00. An admin can change it.
_Avoid_: cutoff, midnight

**Operational day**:
The day a Ride is listed and counted on, from the Tenant's operational-day start up to the next one in the Tenant's time zone. A pickup before that start belongs to the previous operational day, and the roster and an expiring document keep the calendar date.
_Avoid_: calendar day, midnight

**Member**:
A person in one Tenant, with one role: admin, dispatcher, or driver.
_Avoid_: user

**Invitation**:
A pending offer for one email to join a Tenant as admin, dispatcher, or driver. It expires and can be used once. Its mail goes through the mail outbox and is tried again; the admin always gets the copyable link. The id is in the link and is a bearer secret.
_Avoid_: signup link

**Audit entry**:
One record in a Tenant's audit log: when, which member acted, the action, and either the member it was done to, the setting value that changed, the Client (its id, and for a kind change the previous and next kind), the Driver fields that changed, the Driver archived or restored (its id only), or the Vehicle (its id and field names for created, field changed, and archived), or the roster (the calendar date and the Driver and Vehicle ids for a day assigned, changed, or cleared), or the Ride assignment (the Ride id, the Driver id, the Vehicle id, and the field names), or the Vehicle-only change (the Ride id, the Driver id, the Vehicle id, and the field name vehicleId), or the clear (the Ride id, the Driver id and the Vehicle id that were cleared, and the field names), or the reassignment (the Ride id, the new Driver id, the Vehicle id, and the field names), or the Ride acceptance (the Ride id, the Driver id, and the field name state), or the office acceptance by phone (the Ride id, the Driver id, and the field name state), or the Ride marked done (the Ride id, the Driver id, and the field name state; the actor is the person who marked it done), or the No-show after the wait (the Ride id, the Driver id, and the field name state; the actor is the person who marked it), or the early office No-show (the Ride id, the Driver id, and the field name state; the actor is the office member; this action is distinct from a No-show after the wait), or the Ride cancelled (the Ride id, the Driver id or null when the Ride was unassigned, and the field name state; the actor is the person who cancelled), or the Ride declined (the Ride id, the Driver id, the Vehicle id that was cleared, and the field names; the actor is the Driver who declined), or the landing time (the Ride id, the Driver id or null when the Ride was unassigned, and the field name landingAt; the actor is the person who recorded or cleared it), or the Transfer correction (the Transfer id, the Ride id, the Client id, the Location ids, and the names of the fields that changed; the actor is the office member), or the return to assigned (the Ride id, the Driver id, and the field name state; the actor is the office member who corrected the Transfer), or the handoff (the Ride id, the Partner id, the Driver id and the Vehicle id it cleared when there were any, and the field names), or the change of Partner (the Ride id, the new Partner id, and the field names), or the handoff taken back (the Ride id, the Partner id, and the field names), or an unavailability window added, changed, or removed (the window id, the Driver, Vehicle, or Partner id, and the field names), or a contact person added, changed, or removed (the Client id, the contact person id, and the field names), or the Client note saved (the Client id and the field name), or the Partner created, changed, archived, or restored (the Partner id, and the field names when created or changed), or an invoice requested, issued, failed, cancelled, or withdrawn (the invoice id and the Transfer id; the actor is the member who asked), or billing details saved (the Client id and the field names), or the invoicing settings changed (the field names). A handed-off Ride marked done, a No-show, or cancelled holds the Partner id where the entry holds the Driver id. A Client's name is not in the record. A Driver change does not record the phone, the email, or the licence dates. An archive or a restore records the Driver id only. A Vehicle change does not record the plate or the dates. A roster change does not record a plate, a driver name, or a phone. A Ride assignment does not record a plate, a phone, or the must-accept value. A Vehicle-only change does not record a plate, a phone, or the must-accept value. A clear does not record a plate, a phone, or the must-accept value. A reassignment does not record a plate, a phone, the must-accept value, or the previous Driver. A Ride acceptance does not record a name, a phone, a plate, a guest, or the must-accept value. An office acceptance by phone does not record a name, a phone number, a plate, a guest, or the must-accept value. A Ride marked done does not record a name, a phone, a plate, a guest, or the must-accept value. A No-show after the wait does not record a name, a phone, a plate, a guest, a fee, a charge, or the must-accept value. An early office No-show does not record those either. A Ride cancelled does not record a name, a phone, a plate, a guest, or the must-accept value. A Ride declined does not record a name, a phone, a plate, a guest, or the must-accept value. A landing time does not record the instant, a name, a phone, a plate, or a guest. A Transfer correction does not record the guest name, the flight number, the note, the tabla, or the price. A return to assigned does not record a name, a phone, a plate, a guest, or the must-accept value. A handoff, a change of Partner, and a handoff taken back do not record a name, a contact, a plate, or a guest. An unavailability window does not record its instants. A contact person does not record its name, role, phone, or email. A Client note does not record its text. A Partner does not record its name, phone, email, or note. An invoice does not record its number, an amount, an OIB, an address, a guest, or a link. Billing details and the invoicing settings do not record their values, and the token is never recorded. A platform rename, deactivation, or reactivation stores an empty object and no person's name. It is written with the action and never changed or removed.
_Avoid_: history, event, activity

**Driver**:
A Tenant's record of a person who can be assigned to a Ride. It has one email. When the Driver has an account, that email is the member's sign-in email and the office does not type another. When the Driver has no account, the email may be blank. Linking an account copies the sign-in email over whatever was stored. Removing the link leaves the address, and the office may then edit or clear it. It may have no account. A link, when present, joins one member whose role is driver, and that member has at most one Driver. A Driver may be set to must-accept; otherwise assignment is enough. Their upcoming list is the unfinished Rides currently assigned to them. A Ride leaves that list as soon as it is no longer theirs. The phone list does not include the email. Archive hides the Driver from the default list and from a new Ride assignment or reassignment, without deleting the row. A Ride already assigned, and a decline alert, still show the name. The roster still names a day they already have. A new day is refused, and clearing the stored day still works. Unarchive puts the Driver back on the list. An archived row cannot be corrected.
_Avoid_: operator, external collaborator

**Locale**:
The language a user works in, Croatian or English. Each Tenant has a default locale, used when that user has not chosen one. A work order uses the Tenant default locale even when the Driver has chosen another.
_Avoid_: language

**Work order**:
The email sent when a Ride is assigned, when the office changes its Vehicle, when a Transfer correction changes a fact the Driver needs, when it is cleared, when it is handed to a Partner, when it is reassigned, or when it is cancelled. It uses the Tenant's default locale and time zone. A Vehicle change uses changed and still states the cash price. A Transfer correction uses changed for pickup time, a place, the flight number, the guest, a count, the airport mark, the tabla, the note, the client, the Client reference, or the payment method, and for the price while payment is cash. A save that changes none of those sends nothing. A landing-time change sends nothing. Assign, and the new Driver on a reassign, use assigned. Clear, a handoff, and the previous Driver on a reassign, use no longer yours and state no price. Cancel uses cancelled and states no price. A Ride with no Driver sends nothing. The office sees one result per Driver on the action: sent, no email, not sent yet and retried, or not sent because it is no longer current. The result names the Driver and not the address. The Ride stays saved when a send fails. The send is recorded in the mail outbox and tried again. The mail does not ask the Driver to accept and has no link. A cash Ride states the price on assigned and changed; card, invoice to agency, and an extra vehicle do not. It states the Client reference when one is set, and marks a Ride of a group. The audit entry stays the Ride change. It does not gain an "email sent" row.
_Avoid_: SMS, push

**Failed mail**:
A work order or an invitation that did not go out after the automatic attempts and still matters. The office calls it Neuspjeli mail.
_Avoid_: send failed

**Stale mail**:
A work order that is not sent because the Ride is finished (`done` or `no-show`), or because the Ride is cancelled and this mail is neither "no longer yours" nor the cancellation notice, or because a newer work order for the same Ride and the same Driver was recorded after it. Pickup time does not make it stale. "No longer yours" is still sent when the Ride is later cancelled. An invitation mail is stale once the invitation is accepted, revoked, or expired. The office calls it Zastarjeli mail.
_Avoid_: old mail

**Vehicle**:
A vehicle the office can assign. Kind is `fixed` or `occasional`. The registration plate identifies it in the Tenant; three expiry dates (registration, technical inspection, insurance) are calendar days. Archive hides it from the default list without deleting it. A Ride has a Vehicle only when it has a Driver.

**Roster**:
The office's assignment of one Vehicle to one Driver for one calendar date. The date is that day in the Tenant's time zone, stored with no time. A Driver has at most one Vehicle that day, and a Vehicle is given to at most one Driver that day. The office can clear the day. An archived Vehicle cannot be newly given; a row already stored stays until the office clears or replaces it. An archived Driver cannot be given a new day; saving the same pair writes nothing, and a row already stored stays until the office clears it. A later Ride reads this row and may still use a different Vehicle for that one Ride.
_Avoid_: schedule, shift

**Expiring document**:
A driving licence, transport licence, vehicle registration, technical inspection, or insurance whose expiry day is already past or falls within the next 30 days on the Tenant's calendar. An archived Vehicle is not one. An archived Driver is not one on the office list. For a driver, it is only a licence of the Driver linked to that account.
_Avoid_: reminder

**Expired-document warning**:
An assigned or accepted Ride whose Driver's driving licence or transport licence, or whose Vehicle's registration, technical inspection, or insurance, has an expiry day earlier than the calendar date of its pickup in the Tenant's time zone. It names each such document. It does not block assignment and sends nothing.
_Avoid_: expiring document, reminder

**Roster mismatch**:
An assigned or accepted Ride whose Vehicle is rostered to a different Driver on the calendar date of its pickup. A Vehicle with no roster row that day is not a mismatch. It does not block and sends nothing.
_Avoid_: conflict, roster change

**Overlap warning**:
An assigned or accepted Ride that shares its Driver or its Vehicle with another assigned or accepted Ride, where the gap between them is shorter than the relocation gap, a true overlap included. Both Rides show it. It does not block and sends nothing.
_Avoid_: ride_overlap, conflict

**Capacity**:
Whether a Driver, a Vehicle, or a Partner is taken or unavailable at a given time. It is about time, not seats.
_Avoid_: seats, availability

**Free**:
A Driver or a Vehicle is free for a window when it is not archived, no occupying Ride overlaps the window, and no unavailability window covers any part of it. A Partner is free when it is not archived and no unavailability window covers any part of the window; a Ride handed to it does not occupy it. In Croatian it is Slobodan.
_Avoid_: available

**Unavailability window**:
A from–to time during which the office has marked a Driver, a Vehicle, or a Partner as not available. It carries no reason. In Croatian it is Nedostupnost.
_Avoid_: day off, leave, service, absence

**Unavailability warning**:
An assigned or accepted Ride whose Driver or Vehicle, or a handed-off Ride whose Partner, has an unavailability window covering part of its window. It is a warning and sends nothing. In Croatian it is Nedostupan.
_Avoid_: conflict

**Fully booked**:
An unfinished Ride whose window has no free Driver with a free Vehicle and no free Partner. On an unassigned Ride it is a warning. On an assignment or a handoff it refuses the command, and confirming does not pass it. In Croatian it is Popunjeno.
_Avoid_: no capacity, overbooked

**Dispatcher**:
Office staff of a Tenant who manage Transfers and Rides.
_Avoid_: admin

**Admin**:
The owner of a Tenant.

**Superadmin**:
The platform owner. A user with a row in `platform.superadmin` and no Tenant membership. They can list, open, and rename Tenants. Opening a Tenant shows its name, slug, created time, and whether it is active, and does not show that Tenant's clients, drivers, vehicles, rides, members, or audit log.
_Avoid_: admin, owner

**Partner**:
A subcontractor company the office can hand a Ride to. It has a name, and may have one phone, one email, and a note. It has no login and gets no mail. It is archived, never deleted. An archived Partner cannot be handed a new Ride; a Ride already handed to it keeps it and still shows its name. A company that both books Transfers and takes Rides handed to it is a Client and a Partner, two records with no link between them. In Croatian it is Podizvođač; the Croatian word partner is not used. In the English UI it is Subcontractor.
_Avoid_: agency, hotel, Client

**Client**:
An agency, hotel, or individual who books a Transfer. An invoice for a Transfer goes to its Client. It may have contact persons, a Client note, and billing details. In Croatian it is Naručitelj.
_Avoid_: partner, customer

**Client card**:
What the office keeps and sees about one Client: its name and kind, its contact persons, its Client note, and its Ride history. It has no pipeline, no offers, and no communication history.
_Avoid_: CRM, profile

**Contact person**:
A person the office can reach at a Client. It has a name, may have a role in free text, and has a phone, an email, or both. A Client may have several, and none is the main one. A Client of any kind may have them. In Croatian it is Kontakt osoba.
_Avoid_: contact, guest, Member

**Client note**:
The one standing text the office keeps about a Client, such as how the Client wants its guests met or when it pays. A correction replaces it. It is not a log of calls or messages.
_Avoid_: comment, communication history

**Billing details**:
What an invoice needs to know about its Client: the legal name, the country, the OIB for a Croatian Client, an optional VAT id, the address, and whether the guest name goes on the invoice. In Croatian it is Podaci za račun.
_Avoid_: address (alone), company data

**Invoice**:
The Tenant's invoice to a Client for one done Transfer whose payment is invoice to agency, created in the current tool, which gives it its number and date. It is never changed or deleted; a Storno cancels it. A Transfer has at most one invoice that is not cancelled or withdrawn. In v1 an individual Client gets none, and neither does a No-show, a cancelled Ride, or a Transfer whose Price is 0. In Croatian it is Račun.
_Avoid_: bill, receipt, eRačun (one form of an invoice)

**Unsent invoice**:
An invoice, or a domestic Storno, that the current tool has created and the office has not yet sent from it. In Croatian it is Neposlan račun.
_Avoid_: draft

**Failed invoice**:
An invoice the current tool did not create after the automatic attempts, or refused. The office fixes the cause and tries again, or an Admin withdraws it once a lookup shows the current tool has none. In Croatian it is Neuspjeli račun.
_Avoid_: rejected invoice

**Storno**:
The negative invoice that cancels an invoice. After it, the Transfer can be invoiced again under a new number. Only an Admin asks for one. In Croatian it is Storno.
_Avoid_: delete, void, credit note

**Payment-reporting reminder**:
The notice on Home, from the 15th to the 20th of each month in the Tenant's time zone, to report in the current tool the payments received on invoices to Croatian Clients. It is not attached to a Ride.
_Avoid_: payment reminder (to a Client), dunning

**Current tool**:
The invoicing tool the Tenant already uses, where the office sends invoices and reports payments. In v1 it is the fiscalization provider.
_Avoid_: the product's name, invoicing app

**Fiscalization provider**:
The outside service behind the invoicing port that numbers, fiscalizes, and keeps the Tenant's invoices. Transferpro does no fiscalization of its own.
_Avoid_: intermediary (a certified intermediary is a kind of provider for after v1)

**Ride history**:
The Rides of one Client, or the Rides handed to one Partner, of every state, newest pickup first. It also counts how many Rides there are in total, done, No-show, and cancelled.
_Avoid_: activity, history (alone)

**Guest**:
The person who travels, named on the Transfer by one name, the lead of the group. The passenger count covers the rest. A guest is not a Client or a Partner and has no record, contact, or history. A guest who also booked as an individual Client is not linked to that Client. In Croatian it is Gost.
_Avoid_: passenger, customer, client

**Location**:
A place a Ride starts or ends. An airport Location may carry an optional IATA code of three letters. At most one active Location in a Tenant holds a given code. A Ride shows that code beside the Location name when the code is set. A hotel, an address, or any other kind does not carry a code. A Location may carry a reference to its place on a map, set when the office picks a suggested address. Changing the address by hand removes that reference. The office can show a Location that has that reference on a map. The reference is checked again after a year, and removed when the place no longer exists.
_Avoid_: place, stop

**Landing time**:
The actual time the aircraft landed, on an airport pickup. It stays empty until then. A live status writes it only while it is empty and the time is not still in the future. A time a person recorded stays until they clear it. The expected arrival is a different fact and does not start the airport wait.
_Avoid_: expected arrival, ETA

**Stale save**:
An office save of a Transfer, its Ride, or a Client made from data that someone has changed since the form was opened. It is refused. A Driver's state action is not such a change. In Croatian it is Zastarjelo spremanje.
_Avoid_: merge, lock

**Expected arrival**:
The live status's current estimate of when that aircraft will arrive, on an airport pickup. It is stored whenever the status reports one, including a change of less than 15 minutes. A change of at least 15 minutes from the last estimate the Driver was told, or from the first stored estimate when the Driver has been told nothing, is handed to the work-order port. A Ride with no Driver stores the movement and tells nobody until the next ask after a Driver is assigned. A cancelled flight, or one that will arrive at another airport, clears it and hands that port a different fact: the flight will not arrive here. That fact is handed at most once for the designator. It does not start the airport wait, and it does not return an accepted Ride to assigned. Changing the flight number to a different designator clears the expected arrival, the basis of what the Driver was told, the landing time, and that will-not-arrive memory, in the same change. Spacing or case of the same designator clears none of those.
_Avoid_: landing time, ETA

**Channel**:
The way a Transfer reached the Tenant. Manual entry by the office is a channel. The Client is not the channel, and neither is a phone call or a message the office reads before entering the Transfer by hand.
_Avoid_: source, booking source

**Client reference**:
The number under which the Client keeps a booking, such as a voucher number. It is optional and not unique: an arrival and its return journey may share it, and two Clients may use the same number. It is how the office ties a return journey to its arrival. An extra vehicle starts with its main Transfer's, and the Driver sees it. It is not an ExternalRef.
_Avoid_: voucher id, external id

**ExternalRef**:
The Channel and that channel's own identity for one Transfer. No two Transfers of a Tenant share one. On manual entry, Transferpro gives each entry its own, and the office does not type it. Repeating the same entry returns the existing Transfer and changes nothing.
_Avoid_: voucher, Client reference

**Work package (WP)**:
A unit of planned work (`0.1`, `1.2`, …): one branch, one PR. *(draft)*

**Charter**:
`CHARTER.md`, the owner-locked project charter. *(draft)*
