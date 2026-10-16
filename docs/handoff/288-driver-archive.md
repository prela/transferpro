# 288 Driver archive from the catalog panel

Partners, the Client card, and mail stay as they are. Deleting a declining Driver (#286) is not this ticket.

## Decisions

- Archive sets `archived_at`. There is no delete. A second archive or unarchive writes nothing and adds no audit row.
- Admin and Dispatcher only. `driver.archived` and `driver.unarchived` store `{ driverId }` only.
- A new Ride assignment or reassignment of an archived Driver is `409` `ride_driver_archived`. Correcting an archived row is `409` `driver_archived`.
- Office home and the transfer-day catalog load archived Drivers, so an existing Ride still shows the name. A decline alert joins `app.drivers` and does not filter `archived_at`.
- The office expiry list omits an archived Driver. The linked driver account still sees that Driver's licences.
- Restore is the Vrati button on the read-only panel. Vozila has no unarchive.
- A new roster day, or a different Vehicle on a stored day, for an archived Driver is `409` `roster_driver_archived`. Saving the same pair writes nothing. Clearing the day still works. The board shows a day they already have and does not offer a picker.
- `driverAssignState` returns `mustAccept` and `archived` under one share lock. The review below still uses the old name; that rename is the follow-up commit.

## Code review

Fixed point `origin/develop` (`7db0a59`). The review is of the uncommitted first slice. The roster `409`, the decline-alert name assert, and the rename landed after it.

### Standards

**Hard breaches:** none. The new column is `timestamptz` on the existing `app.drivers` table (RLS and the table grant already cover it). Journal `when` is the previous entry plus 1000. `driver.archived` and `driver.unarchived` have a strict `{ driverId }` shape, an `audit_entry_shape` branch, the migration, and `audit.actions.*` in both locales. Appends run on the tenant transaction after the write, with the id only. Routes parse the id with Zod before `withTenantFromSession`. `archiveDriver` and `unarchiveDriver` call `officeOnly`. Transfers import Drivers through `index.ts`. Both locales, Nuxt UI controls, and an extended `e2e/` spec are present. Glossary Driver and Audit entry match the payload.

**Judgement calls**

**Mysterious Name** (and a small **Data Clump**) in `server/modules/drivers/infrastructure/drivers.ts`. The function is still named for one flag, and the value is an unnamed pair:

```ts
export async function driverMustAcceptForAssign(
  transaction: TenantTransaction,
  driverId: string,
): Promise<{ mustAccept: boolean, archived: boolean } | null>
```

`driverFlag.archived` and `driverFlag.mustAccept` then travel together. Rename it so the name covers both fields, and give that pair one type.

**Duplicated Code.** `archiveStoredDriver` and `unarchiveStoredDriver` are the same lock, `update … returning`, empty-row throw, and `appendAuditEntry({ data: { driverId } })`. `server/api/drivers/[id]/archive.post.ts` and `unarchive.post.ts` are the same handler with the function name swapped. The same guard is copied in `assign.ts` and `ride-change.ts`:

```ts
const driverFlag = await driverMustAcceptForAssign(transaction, input.driverId)
if (driverFlag === null)
  throw new RideNotFoundError()
if (driverFlag.archived)
  throw new RideDriverArchivedError()
// …
const mustAccept = driverFlag.mustAccept
```

`RideAssign.vue` and `RideReassign.vue` each add the same `archivedAt === null` filter and the same `ride_driver_archived` branch in `failureKey`. One helper for the stored write, and one assign-time read, would cover both sites.

### Spec

#### (a) Missing or partial

No scope line is absent. Archive and unarchive are tenant-scoped, Admin/Dispatcher only (a driver is 403), audited as `{ driverId }` with no name, and covered by the RLS test. New Ride assign and reassign omit an archived Driver and return 409. The day board and office home load archived Drivers so a Ride name still resolves, and the decline-alert join does not filter `archived_at`. The panel has `⋮` Arhiviraj, "Prikaži arhivirano", a read-only archived row, and Vrati. RLS, unit, and e2e cover archive, unarchive, and that read-only view.

The name rule itself is not asserted: nothing checks that an archived Driver’s name still appears on an existing Ride or a decline alert. Spec: "existing/past Rides and decline alerts still resolve the name" and "Tests: RLS, unit, e2e for archive/unarchive and read-only view."

#### (b) Not asked for

Archived Drivers are removed from the office expiring-document list (`shared/expiring-documents.ts`, glossary). Spec: "not offered for new assignments; existing/past Rides and decline alerts still resolve the name." Documents are not in that definition.

#### (c) Implemented, but wrong

`RosterDay` still calls `GET /api/drivers` with the new default, so an archived Driver leaves the roster board, including a day they already have. Vehicles on that screen are loaded with `includeArchived=true` and stay as text. A roster write still accepts that Driver (`driverIsInTenant` does not look at `archived_at`). Spec: "not offered for new assignments; existing/past Rides and decline alerts still resolve the name."
