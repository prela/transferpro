# 166 Work order on assign

Out of scope: work orders for a change, a reassign, a clear, or a cancel.

## Decisions

- Compose the assigned mail in `shared/work-order.ts`. The status in this slice is assigned. A later command reuses `Mailer.sendWorkOrder` and `{ driverId, outcome }`.
- Read the Client, both Locations, and the Vehicle through those modules' `index.ts`, by id. Do not join `app.clients`, `app.locations`, or `app.vehicles` from transfers.
- A Vehicle has no name column. The description is the vehicle name when one is stored. A blank description omits that line. The plate is always in the body.
- Send after the assign transaction commits. One attempt. A rejection returns `failed` and does not roll the Ride back. `ResendTransportError` still aborts.
- The console line for a work order is `kind: 'work-order'` only. Do not log the subject or the recipient domain. The failure line is `rideId`, `driverId`, and the error type.
- `POST /api/rides/:id/assign` returns `{ ride, workOrders }`. Assign has one notice.

## Code review

## Standards

Reviewed `f3fdbc0` (`git diff a3c33ea...HEAD`). `a3c33ea` resolves; the diff is non-empty.

### Hard

`server/modules/transfers/infrastructure/work-order.ts`, `readAssignedWorkOrder`, joins `app.clients` and `app.locations` and selects `c.name`, `start_place.name`, and `end_place.name`. ADR-0018: another module reaches Clients and Locations only through that module’s public `index.ts`, and references a row by id. The same statement also reads `app.vehicles` description and plate. The import gate states that reach-through-index rule for Vehicles too (`eslint.config.mjs`, `no-transfers-catalog-deep-import`, citing ADR-0018), and it only checks imports, so this join is outside what lint enforces.

### Judgement

**Repeated Switches** in `app/components/RideAssign.vue`: two cascades on the same outcome.

```ts
function workOrderColor(outcome: 'sent' | 'no_email' | 'failed' | undefined) {
  if (outcome === 'failed') return 'error'
  if (outcome === 'no_email') return 'warning'
  return 'success'
}
function workOrderCopy(outcome: 'sent' | 'no_email' | 'failed') {
  if (outcome === 'sent') return 'ride.workOrderSent'
  if (outcome === 'no_email') return 'ride.workOrderNoEmail'
  return 'ride.workOrderFailed'
}
```

One map could supply both the color and the copy key.

**Duplicated Code:** `escapeHtml` in `shared/work-order.ts` repeats the helper already in `server/modules/tenancy/infrastructure/mailer.ts` (`&`, `<`, `>`, `"`). Shared cannot import the mailer; the mailer can import a shared helper.

Not flagged, because a written rule overrides the smell: the mailer stays in tenancy (ADR-0026: one adapter, the existing mailer); `workOrders` is an array (one result per Driver); the console line logs `kind` and domain only, which matches invitation mail, and the address, subject, guest, places, and tabla stay off the log (CHARTER logging; ADR-0026). The failure line is after `withTenantFromSession`, so `tenant_id` is absent under the logger rule that `tenant_id` exists only inside the tenant call. CHARTER requires `request_id` and `tenant_id` on lines inside a tenant call.

Checked and aligned: both locales on the toast (working-rules, i18n); `formatInstant` (no second date formatter); mailer imported from `tenancy/index.ts` (AGENTS.md, no deep imports); Zod on the assign response; `officeOnly` still on the action; audit data stays ids and field names (ADR-0026); an e2e spec was added (AGENTS.md). Assign assertions were reshaped to `{ ride, workOrders }`, not weakened.

## Spec

**(a) Missing or partial**

- Partial. "The office sees sent and no email on the assign action, in Croatian, with an English smoke of that copy." Croatian covers both sentences. The English check only assigns a Driver who has an email and asserts "Work order sent to Ana Sent." It never shows "{name} has no email. No work order was sent."

**(b) Scope creep**

None. Change, reassign, clear, and cancel do not send. The mail is assigned only, after the Ride is saved, with no link and no accept prompt. The `{ ride, workOrders }` body is the one result this action has to return.

**(c) Implemented, but wrong**

- "Logs do not record the address, the guest, the places, or the tabla." The failure log is only `rideId`, `driverId`, and the error type. A successful console send still logs the recipient domain (`example.test` from `ana@example.test`).
