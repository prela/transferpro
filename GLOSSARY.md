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
A Ride with both a Driver and a Vehicle, which that Driver has not accepted.

**Accepted**:
A Ride that its Driver has accepted. Changing only the Vehicle, with the same Driver, leaves the Ride accepted.

**Done**:
A finished Ride that was carried out.
_Avoid_: complete, closed

**No-show**:
A finished Ride that the guest did not take. When it may be marked, and who is charged, are still open.
_Avoid_: cancellation

**Cancelled**:
A finished Ride that will not run. It stays on record.
_Avoid_: deleted

**Driver**:
The person assigned to drive a Ride. Their upcoming list is the unfinished Rides currently assigned to them. A Ride leaves that list as soon as it is no longer theirs.
_Avoid_: operator

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
