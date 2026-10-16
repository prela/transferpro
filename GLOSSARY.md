# Transferpro

Dispatch for a transfer company: take a booking, assign the Ride, and record how it ended.

## Language

**Tenant**:
A transfer company using Transferpro. The company and its Better Auth organization are the same Tenant. In Croatian it is Tvrtka, and in the English UI it is Company.
_Avoid_: organization, firm

**Transfer**:
The booking. It names the Client, the pickup time, the start and end Locations, the passenger count, the guest name, an optional flight number, a price in EUR, the payment (`cash`, `card`, or `invoice_to_agency`), whether the pickup is an airport, the luggage count, the child-seat count, an optional note, and an optional tabla. The tabla is the words on the meet sign for this pickup. It is text on the Transfer, not on the Client. A blank is stored as empty text. There is no image. Creating a Transfer creates one Ride in `unassigned`. The airport mark is stored as entered and is not inferred from the flight number. `invoice_to_agency` is a recorded choice. The Driver sees the price and the payment method only for cash; card and invoice to agency hide both (ADR-0009, extended by ADR-0020). That phone rule is not on the office screen. The Transfer is the order: there is no separate Order above it. It has a Channel and an ExternalRef, and may carry a Client reference.
_Avoid_: Ride, job, order

**Ride**:
The execution of a Transfer. One Transfer may have several Rides when the same journey is split across several Vehicles. A return journey is its own Transfer, not a second Ride. In v1 it has exactly one, created with the Transfer. A Ride is not deleted.
_Avoid_: trip, job, leg

**Transfer duration**:
The minutes a Ride occupies after its pickup, or after its landing when a landing is stored. The Tenant's default is 60. It is not a No-show wait.

**Relocation gap**:
The minutes the office wants between the end of one occupied Ride and the pickup of the next for the same Driver or the same Vehicle. The Tenant's default is 15. A shorter gap warns. It does not block. A gap of exactly that length is not a warning.

**Unassigned**:
A Ride with no Driver and no Vehicle.

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
The tier of an overlap warning, a roster mismatch, or an expired-document warning. It does not block and asks for no action now. In Croatian it is Upozorenje.
_Avoid_: alarm, urgent

**Assigned**:
A Ride with both a Driver and a Vehicle. When it requires acceptance, it is waiting on acceptance, including after an earlier acceptance was cleared. Whether it requires acceptance is copied from the Driver at assignment and stays on the Ride. The Vehicle on a new assignment starts as that Driver's roster Vehicle for the calendar day, and the office can still choose a different Vehicle for that one Ride. A roster change does not change a Ride already assigned. An assigned Ride occupies its Driver and its Vehicle for the transfer duration, including when it is in progress. A true overlap blocks assign, a vehicle change, a reassignment, and a Transfer correction that moves when the Ride starts or ends, until the office confirms. Clear does not.
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
A finished Ride the guest did not take. The Driver marks it after the Tenant's wait. The office may mark it earlier from the same source state. v1 records it and charges nothing.
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

**In progress**:
A Ride that has a Driver, is not finished, and is not waiting on acceptance, once its pickup is in the past. An earlier day's pickup stays in progress until the Ride is done, a no-show, or cancelled.
_Avoid_: started, a Ride state

**Unclosed mark**:
An in-progress Ride once 60 minutes have passed since its scheduled pickup. A recorded landing does not move that instant.
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
A pending offer for one email to join a Tenant as admin, dispatcher, or driver. It expires and can be used once.
_Avoid_: signup link

**Audit entry**:
One record in a Tenant's audit log: when, which member acted, the action, and either the member it was done to, the setting value that changed, the Client (its id, and for a kind change the previous and next kind), the Driver fields that changed, the Driver archived or restored (its id only), or the Vehicle (its id and field names for created, field changed, and archived), or the roster (the calendar date and the Driver and Vehicle ids for a day assigned, changed, or cleared), or the Ride assignment (the Ride id, the Driver id, the Vehicle id, and the field names), or the Vehicle-only change (the Ride id, the Driver id, the Vehicle id, and the field name vehicleId), or the clear (the Ride id, the Driver id and the Vehicle id that were cleared, and the field names), or the reassignment (the Ride id, the new Driver id, the Vehicle id, and the field names), or the Ride acceptance (the Ride id, the Driver id, and the field name state), or the office acceptance by phone (the Ride id, the Driver id, and the field name state), or the Ride marked done (the Ride id, the Driver id, and the field name state; the actor is the person who marked it done), or the No-show after the wait (the Ride id, the Driver id, and the field name state; the actor is the person who marked it), or the early office No-show (the Ride id, the Driver id, and the field name state; the actor is the office member; this action is distinct from a No-show after the wait), or the Ride cancelled (the Ride id, the Driver id or null when the Ride was unassigned, and the field name state; the actor is the person who cancelled), or the Ride declined (the Ride id, the Driver id, the Vehicle id that was cleared, and the field names; the actor is the Driver who declined), or the landing time (the Ride id, the Driver id or null when the Ride was unassigned, and the field name landingAt; the actor is the person who recorded or cleared it), or the Transfer correction (the Transfer id, the Ride id, the Client id, the Location ids, and the names of the fields that changed; the actor is the office member), or the return to assigned (the Ride id, the Driver id, and the field name state; the actor is the office member who corrected the Transfer). A Client's name is not in the record. A Driver change does not record the phone, the email, or the licence dates. An archive or a restore records the Driver id only. A Vehicle change does not record the plate or the dates. A roster change does not record a plate, a driver name, or a phone. A Ride assignment does not record a plate, a phone, or the must-accept value. A Vehicle-only change does not record a plate, a phone, or the must-accept value. A clear does not record a plate, a phone, or the must-accept value. A reassignment does not record a plate, a phone, the must-accept value, or the previous Driver. A Ride acceptance does not record a name, a phone, a plate, a guest, or the must-accept value. An office acceptance by phone does not record a name, a phone number, a plate, a guest, or the must-accept value. A Ride marked done does not record a name, a phone, a plate, a guest, or the must-accept value. A No-show after the wait does not record a name, a phone, a plate, a guest, a fee, a charge, or the must-accept value. An early office No-show does not record those either. A Ride cancelled does not record a name, a phone, a plate, a guest, or the must-accept value. A Ride declined does not record a name, a phone, a plate, a guest, or the must-accept value. A landing time does not record the instant, a name, a phone, a plate, or a guest. A Transfer correction does not record the guest name, the flight number, the note, the tabla, or the price. A return to assigned does not record a name, a phone, a plate, a guest, or the must-accept value. A platform rename, deactivation, or reactivation stores an empty object and no person's name. It is written with the action and never changed or removed.
_Avoid_: history, event, activity

**Driver**:
A Tenant's record of a person who can be assigned to a Ride. It has one email. When the Driver has an account, that email is the member's sign-in email and the office does not type another. When the Driver has no account, the email may be blank. Linking an account copies the sign-in email over whatever was stored. Removing the link leaves the address, and the office may then edit or clear it. It may have no account. A link, when present, joins one member whose role is driver, and that member has at most one Driver. A Driver may be set to must-accept; otherwise assignment is enough. Their upcoming list is the unfinished Rides currently assigned to them. A Ride leaves that list as soon as it is no longer theirs. The phone list does not include the email. Archive hides the Driver from the default list and from a new Ride assignment or reassignment, without deleting the row. A Ride already assigned, and a decline alert, still show the name. The roster still names a day they already have and does not offer them a new day. Unarchive puts the Driver back on the list. An archived row cannot be corrected.
_Avoid_: operator, external collaborator

**Locale**:
The language a user works in, Croatian or English. Each Tenant has a default locale, used when that user has not chosen one. A work order uses the Tenant default locale even when the Driver has chosen another.
_Avoid_: language

**Work order**:
The email sent when a Ride is assigned, when the office changes its Vehicle, when a Transfer correction changes a fact the Driver needs, when it is cleared, when it is reassigned, or when it is cancelled. It uses the Tenant's default locale and time zone. A Vehicle change uses changed and still states the cash price. A Transfer correction uses changed for pickup time, a place, the flight number, the guest, a count, the airport mark, the tabla, the note, the client, or the payment method, and for the price while payment is cash. A save that changes none of those sends nothing. A landing-time change sends nothing. Assign, and the new Driver on a reassign, use assigned. Clear, and the previous Driver on a reassign, use no longer yours and state no price. Cancel uses cancelled and states no price. A Ride with no Driver sends nothing. The office sees one result per Driver on the action: sent, no email, or send failed. The result names the Driver and not the address. The Ride stays saved when a send fails, and the send is not retried. The mail does not ask the Driver to accept and has no link. A cash Ride states the price on assigned and changed; card and invoice to agency do not. The audit entry stays the Ride change. It does not gain an "email sent" row.
_Avoid_: SMS, push

**Vehicle**:
A vehicle the office can assign. Kind is `fixed` or `occasional`. The registration plate identifies it in the Tenant; three expiry dates (registration, technical inspection, insurance) are calendar days. Archive hides it from the default list without deleting it. A Ride has a Vehicle only when it has a Driver.

**Roster**:
The office's assignment of one Vehicle to one Driver for one calendar date. The date is that day in the Tenant's time zone, stored with no time. A Driver has at most one Vehicle that day, and a Vehicle is given to at most one Driver that day. The office can clear the day. An archived Vehicle cannot be newly given; a row already stored stays until the office clears or replaces it. An archived Driver is not offered a new day; a row already stored stays until the office clears it. A later Ride reads this row and may still use a different Vehicle for that one Ride.
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

**Dispatcher**:
Office staff of a Tenant who manage Transfers and Rides.
_Avoid_: admin

**Admin**:
The owner of a Tenant.

**Superadmin**:
The platform owner. A user with a row in `platform.superadmin` and no Tenant membership. They can list, open, and rename Tenants. Opening a Tenant shows its name, slug, created time, and whether it is active, and does not show that Tenant's clients, drivers, vehicles, rides, members, or audit log.
_Avoid_: admin, owner

**Partner**:
A subcontractor company a Ride is handed to. It has no login. A company that both books Transfers and takes Rides handed to it is a Client and a Partner, two records with no link between them. In Croatian it is Podizvođač; the Croatian word partner is not used. In the English UI it is Subcontractor.
_Avoid_: agency, hotel, Client

**Client**:
An agency, hotel, or individual who books a Transfer. An invoice for a Transfer goes to its Client. In Croatian it is Naručitelj.
_Avoid_: partner, customer

**Guest**:
The person who travels, named on the Transfer by one name, the lead of the group. The passenger count covers the rest. A guest is not a Client or a Partner and has no record, contact, or history. A guest who also booked as an individual Client is not linked to that Client. In Croatian it is Gost.
_Avoid_: passenger, customer, client

**Location**:
A place a Ride starts or ends. An airport Location may carry an optional IATA code of three letters. A hotel, an address, or any other kind does not. A Location may carry a reference to its place on a map, set when the office picks a suggested address. Changing the address by hand removes that reference.
_Avoid_: place, stop

**Landing time**:
The actual time the aircraft landed, on an airport pickup. It stays empty until then. A live status writes it only while it is empty and the time is not still in the future. A time a person recorded stays until they clear it. The expected arrival is a different fact and does not start the airport wait.
_Avoid_: expected arrival, ETA

**Expected arrival**:
The live status's current estimate of when that aircraft will arrive, on an airport pickup. It is stored whenever the status reports one, including a change of less than 15 minutes. A change of at least 15 minutes from the last estimate the Driver was told, or from the first stored estimate when the Driver has been told nothing, is handed to the work-order port. A Ride with no Driver stores the movement and tells nobody until the next ask after a Driver is assigned. A cancelled flight, or one that will arrive at another airport, clears it and hands that port a different fact: the flight will not arrive here. That fact is handed at most once for the designator. It does not start the airport wait, and it does not return an accepted Ride to assigned. Changing the flight number to a different designator clears the expected arrival, the basis of what the Driver was told, the landing time, and that will-not-arrive memory, in the same change. Spacing or case of the same designator clears none of those.
_Avoid_: landing time, ETA

**Channel**:
The way a Transfer reached the Tenant. Manual entry by the office is a channel. The Client is not the channel, and neither is a phone call or a message the office reads before entering the Transfer by hand.
_Avoid_: source, booking source

**Client reference**:
The number under which the Client keeps a booking, such as a voucher number. It is optional and not unique: an arrival and its return journey may share it, and two Clients may use the same number. It is how the office ties a return journey to its arrival. It is not an ExternalRef.
_Avoid_: voucher id, external id

**ExternalRef**:
The Channel and that channel's own identity for one Transfer. No two Transfers of a Tenant share one. On manual entry, Transferpro gives each entry its own, and the office does not type it.
_Avoid_: voucher, Client reference

**Work package (WP)**:
A unit of planned work (`0.1`, `1.2`, …): one branch, one PR. *(draft)*

**Charter**:
`CHARTER.md`, the owner-locked project charter. *(draft)*
