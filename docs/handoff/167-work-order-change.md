# 167 Work order on a Vehicle change, a clear, or a reassign

Out of scope: a cancelled work order, and a changed work order for any field other than the Vehicle.

## Decisions

- Status words are `Promijenjeno` / `Changed` and `Više nije vaše` / `No longer yours`. Compose them in `shared/work-order.ts`. Cash price stays on assigned and changed only.
- A clear, and the previous Driver on a reassign, are mailed the Vehicle that Driver had. That pair is read after the update, by id, because the Ride no longer stores it.
- `workOrders` on a reassign is the new Driver (assigned), then the previous Driver (no longer yours). One rejection does not skip the other. `ResendTransportError` still aborts.
- The three routes return `{ ride, workOrders }`. The address is not on it. Audit stays the Ride change.
- The glossary names these three sends. It does not limit `changed` to a Vehicle change. ADR-0026 still lists the other changed fields, and they are not this slice.

## Code review

Reviewed uncommitted `feature/167-work-order-change` against `origin/develop` (`git diff origin/develop`, plus untracked `app/work-order-notice.ts` and `e2e/work-order-change.spec.ts`). No commits. The glossary sentence below was corrected after this review so it no longer says the changed mail is only a Vehicle change.

## Standards

### Hard

**GLOSSARY.md (Work order)** contradicts ADR-0026. AGENTS.md: do not contradict an ADR; propose a new one. The new definition sends mail on assign, “when only its Vehicle changes,” clear, or reassign. ADR-0026 also uses `changed` for pickup time, places, flight, guest, counts, airport mark, tabla, note, client, payment, and the cash price, and `cancelled` on cancel. “Only its Vehicle” closes that list.

### Judgement

**Mysterious Name.** `readAssignedWorkOrder` and `deliverAssignedWorkOrder` now also send changed and no-longer-yours mail. `held` does not say these are the Driver and Vehicle just removed:

```ts
readAssignedWorkOrder(transaction, rideId, held?: { driverId: string, vehicleId: string })
deliverAssignedWorkOrder(order, mailer, log?, status: WorkOrderStatus = 'assigned')
```

**Duplicated Code.** The same toast is built in `RideReassign.vue` and `RideVehicle.vue` (`workOrderNotice`, driver name, `toast.add`). `RideAssign.vue` and `TransferDay.vue` repeat the single-notice form (`shown === undefined ? undefined : t(shown.key, …)`).

**Duplicated Code.** `Delivery` and `mailerFrom` in `ride-change.ts` copy `assignRide` (`delivery?.mailer ?? mailerForApp(loadAppEnv())`). `changeVehicle`, `clearRide`, and `reassignRide` each read after save, then call `deliverAssignedWorkOrder`.

**Data Clump.** `ReleasedAssignment { driverId, vehicleId }` in `ride-change.ts` is declared again as the inline `held` argument on `readAssignedWorkOrder`.

**Middle Man.** `composeAssignedWorkOrder` only returns `composeWorkOrder(facts, 'assigned')`. Its comment (“Later commands pass a status”) is already stale in this diff.

No other documented breaches. Failure logs keep ride and driver ids and drop the provider message (CHARTER logging; ADR-0026). Both mail locales are in `STATUS_COPY`. Routes still parse with Zod and call `officeOnly`. Clients, locations, and vehicles still load through their modules (ADR-0018). The new e2e spec’s `shared/date` import matches existing specs.

## Spec

**(a) Missing or partial**

None. Vehicle change, clear, and reassign each mail after the Ride commits. A Vehicle change uses status changed and keeps the assignment body, including the cash price. Clear, and the previous Driver on a reassign, use no longer yours with no price. The new Driver on a reassign uses assigned, and the cash line is added only when payment is cash (`status !== 'no_longer_yours' && payment === 'cash'`), so card and invoice-to-agency stay silent. Each Driver is a separate `sent` / `no_email` / `failed` notice. A rejected send does not roll back the save. Toasts name the Driver. The response has no address. Audit stays `ride.vehicle_changed`, `ride.cleared`, or `ride.reassigned`, with no email-sent row. Failure logs are ride id, driver id, and error type. Mail uses the tenant default locale and time zone. Subject is status, departure, and pickup. The body starts with the status, does not ask the Driver to accept, and has no link. Tests inject a mailer. Under `NODE_ENV=test`, `mailerForApp` uses the fake mailer. Cancel is not sent.

**(b) Scope creep**

None. `RideAssign.vue` only shares the existing outcome toast. No cancel mail, and no mail for other field edits.

**(c) Implemented, but wrong**

None.
