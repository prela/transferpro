# 169 Work order on cancel

Out of scope: a changed work order for any field other than the Vehicle.

## Decisions

- Status words are `Otkazano` / `Cancelled`. Compose them in `shared/work-order.ts`. Cash price stays on assigned and changed only. Cancelled never states a price.
- Send after the cancel transaction commits. A Ride with no Driver has an empty `workOrders` list and sends nothing. A blank email is `no_email`. A rejection is `failed` and the Ride stays cancelled. `ResendTransportError` still aborts.
- `POST /api/rides/:id/cancel` returns `{ ride, workOrders }`. The address is not on it. Audit stays `ride.cancelled`, with no email-sent row.
- The office toast title is `ride.cancelled`. The description is the existing work-order outcome, and it names the Driver.

## Code review

Reviewed uncommitted `feature/169-work-order-cancel` against `origin/develop` (`git diff origin/develop`, plus untracked `e2e/work-order-cancel.spec.ts`). No commits.

## Standards

**Hard violations:** none.

**Judgement — Duplicated Code**

`server/modules/transfers/infrastructure/cancel.ts` inlines the delivery parameter and mailer fallback that `ride-change.ts` already names `Delivery` and `mailerFrom`, and a third copy of the office role check (`officeOnly` in `assign-access.ts` and `ride-change.ts`):

```ts
delivery?: { mailer: Mailer, logger?: Logger },
if (actor.role !== 'admin' && actor.role !== 'dispatcher')
  throw new TenantAccessError(403)
const mailer = delivery?.mailer ?? mailerForApp(loadAppEnv())
```

`app/components/TransferDay.vue` `confirmCancelRide` repeats the `confirmClear` toast:

```ts
const notice = cancelled.workOrders[0]
const shown = notice === undefined ? undefined : workOrderNotice(notice.outcome)
toast.add({ title: t('ride.cancelled'), description: ..., color: shown?.color ?? 'success' })
```

`server/api/rides.rls.test.ts` repeats the same three-method mailer stub four times in the new test. `e2e/work-order-cancel.spec.ts` copies `addDriver`, `addVehicle`, and `recordTodayRide` from `e2e/work-order-assign.spec.ts`.

**Matches documented standards.** Imports stay on module `index.ts` files; `./work-order` is inside transfers (ADR-0018, AGENTS.md). Mail goes out after commit, cancelled states no price, and a Ride with no Driver sends nothing (ADR-0026). The glossary term was updated (AGENTS.md). Both locales shipped (`docs/agents/working-rules.md`, i18n). The route parses `cancelledRideResultSchema`. Audit stays `ride.cancelled` with ids only. The UI change has an e2e spec. The spread across shared, infrastructure, route, and UI matches the existing work-order commands, so Shotgun Surgery does not apply. `workOrders` as a one-entry array matches `AssignedRide`, so it is not speculative.

## Spec

### (a) Missing or partial

None. Against #169 and the inherited #162 lines, the diff does all of the following:

- One work order, status `cancelled`, no price, including a cash Ride (`composeWorkOrder` adds the cash line only for `assigned` or `changed`).
- No Driver: empty `workOrders`, no send. Blank email: Ride stays cancelled, outcome `no_email`, no send.
- Provider rejection: outcome `failed`, row stays `cancelled`, no retry. Send runs after `withTenantFromSession` commits, through the existing mailer port; tests pass a fake.
- Result is one `{ driverId, outcome }` and the failure log is ride id, driver id, and error type. Neither carries the address, guest, places, or tabla.
- Audit stays `ride.cancelled` only.
- Playwright covers the new office copy in Croatian (no Driver, sent, no email) plus an English sent smoke. The journey does not re-prove the field matrix.

### (b) Scope creep

None. The `{ ride, workOrders }` envelope, the cancel toast, the glossary sentence, and the `cancelled` status are the office result and the mail this ticket asks for.

### (c) Implemented but wrong

None. `cancelRide` mails the current Driver with `'cancelled'` after commit. A normal provider error becomes `failed` and does not roll the Ride back. Locale and time zone come from tenant settings (the integration test sets the user locale to English and still expects the Croatian, Zagreb subject). The mail subject is status, departure, and pickup; the body starts with the status; there is no link and no accept line.
