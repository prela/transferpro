# Transferpro

Dispatch for a transfer company: take a booking, assign the Ride, and record how it ended.

## Language

**Tenant**:
A transfer company using Transferpro. The company and its Better Auth organization are the same Tenant.

**Transfer**:
The booking.
_Avoid_: Ride, job

**Ride**:
The execution of a Transfer. One Transfer may have several Rides. In v1 it has exactly one, created with the Transfer. A Ride is not deleted.
_Avoid_: trip, job, leg

**Unassigned**:
A Ride with no Driver and no Vehicle.

**Assigned**:
A Ride with both a Driver and a Vehicle. When it requires acceptance, it is waiting on acceptance, including after an earlier acceptance was cleared.
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

**Cancelled**:
A finished Ride that will not run. It stays on record.
_Avoid_: deleted

**Member**:
A person in one Tenant, with one role: admin, dispatcher, or driver.
_Avoid_: user

**Invitation**:
A pending offer for one email to join a Tenant as admin, dispatcher, or driver. It expires and can be used once.
_Avoid_: signup link

**Driver**:
A Tenant's record of a member whose role is driver. That member has at most one Driver. A Driver may be set to must-accept; otherwise assignment is enough. Their upcoming list is the unfinished Rides currently assigned to them. A Ride leaves that list as soon as it is no longer theirs.
_Avoid_: operator, external collaborator

**Locale**:
The language a user works in, Croatian or English. Each Tenant has a default locale, used only when that user has not chosen one.
_Avoid_: language

**Vehicle**:
The vehicle set on a Ride together with a Driver. A Ride has a Vehicle only when it has a Driver.

**Dispatcher**:
Office staff of a Tenant who manage Transfers and Rides.
_Avoid_: admin

**Admin**:
The owner of a Tenant.

**Partner**:
A subcontractor company a Ride is handed to. *(draft)*

**Client**:
An agency, hotel, or individual who books a Transfer. *(draft)*

**BookingSource**:
A port through which bookings are imported. *(draft)*

**ExternalRef**:
The `source` and `external_id` that identify an imported booking. *(draft)*

**Work package (WP)**:
A unit of planned work (`0.1`, `1.2`, …): one branch, one PR. *(draft)*

**Charter**:
`CHARTER.md`, the owner-locked project charter. *(draft)*
