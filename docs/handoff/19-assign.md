# 19 Assign a Driver and a Vehicle

Slice 1 is the database, the assign command, and the roster pre-fill. Slice 2 is the screens and e2e.

## Decisions

- The Ride stores `must_accept`, a copy of the Driver's setting at assignment. It is null while the Ride is `unassigned`. `assigned` requires a Driver, a Vehicle, and that copy. Later states are not constrained in migration 0019; this slice does not write them.
- There is no `assigned_at` and no `assigned_by`. The audit entry's actor and `occurred_at` are that record (ADR-0014).
- There is no transition table. The transition is one `UPDATE ... WHERE state = 'unassigned'`. A refusal updates zero rows and appends no `ride.assigned` entry.
- A Driver or a Vehicle from another Tenant is 404, the same as missing, because row security hides the other Tenant. 400 is only a body that does not name both ids. The composite foreign keys are the database backstop, on Rides and on the roster.
- Drivers have no archived or inactive column, so assignment does not refuse a Driver for that reason. An archived Vehicle is 409 `ride_vehicle_archived`. A Ride that is not unassigned, including the loser of a concurrent assign, is 409 `ride_not_unassigned`.
- `POST /api/rides/:id/assign` takes `{ driverId, vehicleId }`. The path is the Ride.
- `GET /api/rides/:id/roster-vehicle?driverId=` returns `{ vehicleId }` or `{ vehicleId: null }` when that local day has no row or the Vehicle is archived. It does not write. Assign still accepts any same-tenant Vehicle that is not archived. Changing the roster does not update a Ride.
- The pickup day is `calendarDateInTimeZone` of `pickup_at` in the Tenant time zone, the same instant the day list uses. It is not a `date` cast of the stored instant.
- Copy for the new codes: `ride.vehicleArchived` and `ride.notUnassigned`, in Croatian and English. The audit screen label is `audit.actions.ride.assigned`.
- The assign transaction reads the Driver and the Vehicle `for share`. A must-accept correction and archive take `for update`, so they cannot commit between that read and the Ride update. The roster pre-fill still uses the unlocked Vehicle presence read.

## Applying 0019 on an existing database

Older `server/modules/roster/infrastructure/roster.rls.test.ts` runs left `app.roster` rows whose driver or vehicle no longer exists. `roster_driver_fk` and `roster_vehicle_fk` then fail with `23503`.

Run this read-only check before deploying to production. It lists roster rows whose `(tenant_id, driver_id)` or `(tenant_id, vehicle_id)` has no match:

```sql
select r.tenant_id, r.id, r.roster_date, r.driver_id, r.vehicle_id
from app.roster as r
where not exists (
  select 1
  from app.drivers as d
  where d.tenant_id = r.tenant_id
    and d.id = r.driver_id
)
or not exists (
  select 1
  from app.vehicles as v
  where v.tenant_id = r.tenant_id
    and v.id = r.vehicle_id
);
```

For a local or development database only, delete those orphans and then apply the migration:

```sql
delete from app.roster as r
where not exists (
  select 1
  from app.drivers as d
  where d.tenant_id = r.tenant_id
    and d.id = r.driver_id
)
or not exists (
  select 1
  from app.vehicles as v
  where v.tenant_id = r.tenant_id
    and v.id = r.vehicle_id
);
```

Do not run that delete on production. Run the check query first. A production row in the result needs a decision, not a blanket delete.

Older `server/modules/transfers/infrastructure/transfer.rls.test.ts` runs left an assigned Ride with no Driver, no Vehicle, or no must-accept copy. `rides_assigned_pair` then fails with `23514` on such a development database.

Run this read-only check as well. It lists Rides that are not `unassigned` and are missing a Driver, a Vehicle, or the must-accept copy:

```sql
select id, tenant_id, state from app.rides where state <> 'unassigned' and (driver_id is null or vehicle_id is null or must_accept is null);
```

For a local or development database only, return those rows to `unassigned` and clear the pair. `rides_unassigned_open` requires the Driver, the Vehicle, and the must-accept copy to be null together, so changing the state alone is refused:

```sql
update app.rides
set state = 'unassigned', driver_id = null, vehicle_id = null, must_accept = null
where state <> 'unassigned'
  and (driver_id is null or vehicle_id is null or must_accept is null);
```

Deleting those test rows is the same local cleanup when they are leftovers from that file. Do not run either statement on production. A production row in the result needs a decision, not a blanket update.

Every check in this section must run as the owner/migration role. Under the app role, FORCE RLS hides every row and the check falsely returns empty.

## Left for slice 2

The screens, in Croatian and English, in light and dark, and the Playwright spec. Reassign, clear, vehicle-only change, and decline are later commands (ADR-0005, ADR-0006).
