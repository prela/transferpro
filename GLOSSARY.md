# Transferpro

Dispatch for a transfer company: take a booking, assign the Ride, and record how it ended.

## Language

**Tenant**:
A transfer company using Transferpro. The company and its Better Auth organization are the same Tenant.

**Transfer**:
The booking. It names the Client, the pickup time, the start and end Locations, the passenger count, the guest name, an optional flight number, a price in EUR, the payment (`cash`, `card`, or `invoice_to_agency`), whether the pickup is an airport, the luggage count, the child-seat count, an optional note, and an optional tabla. The tabla is the words on the meet sign for this pickup. It is text on the Transfer, not on the Client. A blank is stored as empty text. There is no image. Creating a Transfer creates one Ride in `unassigned`. The airport mark is stored as entered and is not inferred from the flight number. `invoice_to_agency` is a recorded choice; invoicing is not v1. The Driver sees the price and the payment method only for cash; card and invoice to agency hide both (ADR-0009, extended by ADR-0020). That phone rule is not on the office screen.
_Avoid_: Ride, job

**Ride**:
The execution of a Transfer. One Transfer may have several Rides. In v1 it has exactly one, created with the Transfer. A Ride is not deleted.
_Avoid_: trip, job, leg

**Unassigned**:
A Ride with no Driver and no Vehicle.

**Unassigned alarm**:
An unfinished unassigned Ride during the four hours before its pickup. It is not an acceptance deadline.
_Avoid_: acceptance deadline

**Assigned**:
A Ride with both a Driver and a Vehicle. When it requires acceptance, it is waiting on acceptance, including after an earlier acceptance was cleared. Whether it requires acceptance is copied from the Driver at assignment and stays on the Ride. The Vehicle on a new assignment starts as that Driver's roster Vehicle for the calendar day, and the office can still choose a different Vehicle for that one Ride. A roster change does not change a Ride already assigned.
_Avoid_: pending

**Waiting on acceptance**:
An assigned Ride that requires acceptance, at any pickup time, until it is accepted or cancelled, or the Driver declines it back to unassigned.
_Avoid_: pending

**Accepted**:
A Ride that requires acceptance and has been accepted, by its Driver or by the office after confirming with that Driver by phone. Changing the pickup time, where it starts, where it ends, or the flight number returns it to assigned. Changing only the Vehicle does not.
_Avoid_: confirmed (as a separate state)

**Done**:
A finished Ride that was carried out.
_Avoid_: complete, closed

**No-show**:
A finished Ride the guest did not take, after the Tenant's wait. v1 records it and charges nothing.
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
One record in a Tenant's audit log: when, which member acted, the action, and either the member it was done to, the setting value that changed, the Client (its id, and for a kind change the previous and next kind), the Driver fields that changed, or the Vehicle (its id and field names for created, field changed, and archived), or the roster (the calendar date and the Driver and Vehicle ids for a day assigned, changed, or cleared), or the Ride assignment (the Ride id, the Driver id, the Vehicle id, and the field names), or the Ride acceptance (the Ride id, the Driver id, and the field name state), or the office acceptance by phone (the Ride id, the Driver id, and the field name state). A Client's name is not in the record. A Driver change does not record the phone or the licence dates. A Vehicle change does not record the plate or the dates. A roster change does not record a plate, a driver name, or a phone. A Ride assignment does not record a plate, a phone, or the must-accept value. A Ride acceptance does not record a name, a phone, a plate, a guest, or the must-accept value. An office acceptance by phone does not record a name, a phone number, a plate, a guest, or the must-accept value. A platform rename, deactivation, or reactivation stores an empty object and no person's name. It is written with the action and never changed or removed.
_Avoid_: history, event, activity

**Driver**:
A Tenant's record of a person who can be assigned to a Ride. It may have no account. A link, when present, joins one member whose role is driver, and that member has at most one Driver. A Driver may be set to must-accept; otherwise assignment is enough. Their upcoming list is the unfinished Rides currently assigned to them. A Ride leaves that list as soon as it is no longer theirs.
_Avoid_: operator, external collaborator

**Locale**:
The language a user works in, Croatian or English. Each Tenant has a default locale, used only when that user has not chosen one.
_Avoid_: language

**Vehicle**:
A vehicle the office can assign. Kind is `fixed` or `occasional`. The registration plate identifies it in the Tenant; three expiry dates (registration, technical inspection, insurance) are calendar days. Archive hides it from the default list without deleting it. A Ride has a Vehicle only when it has a Driver.

**Roster**:
The office's assignment of one Vehicle to one Driver for one calendar date. The date is that day in the Tenant's time zone, stored with no time. A Driver has at most one Vehicle that day, and a Vehicle is given to at most one Driver that day. The office can clear the day. An archived Vehicle cannot be newly given; a row already stored stays until the office clears or replaces it. A later Ride reads this row and may still use a different Vehicle for that one Ride.
_Avoid_: schedule, shift

**Expiring document**:
A driving licence, transport licence, vehicle registration, technical inspection, or insurance whose expiry day is already past or falls within the next 30 days on the Tenant's calendar. An archived Vehicle is not one. For a driver, it is only a licence of the Driver linked to that account.
_Avoid_: reminder

**Dispatcher**:
Office staff of a Tenant who manage Transfers and Rides.
_Avoid_: admin

**Admin**:
The owner of a Tenant.

**Superadmin**:
The platform owner. A user with a row in `platform.superadmin` and no Tenant membership. They can list, open, and rename Tenants. Opening a Tenant shows its name, slug, created time, and whether it is active, and does not show that Tenant's clients, drivers, vehicles, rides, members, or audit log.
_Avoid_: admin, owner

**Partner**:
A subcontractor company a Ride is handed to. *(draft)*

**Client**:
An agency, hotel, or individual who books a Transfer. *(draft)*

**Location**:
A place a Ride starts or ends.
_Avoid_: place, stop

**BookingSource**:
A port through which bookings are imported. *(draft)*

**ExternalRef**:
The `source` and `external_id` that identify an imported booking. *(draft)*

**Work package (WP)**:
A unit of planned work (`0.1`, `1.2`, …): one branch, one PR. *(draft)*

**Charter**:
`CHARTER.md`, the owner-locked project charter. *(draft)*
