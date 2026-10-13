# 168 Work order when a Transfer is corrected

Out of scope: a work order for decline, done, no-show, or a landing time. Those commands already send nothing.

## Decisions

- A correction mails the current Driver one work order with status `changed`, after the booking commits. `workOrders` is empty when the Ride has no Driver, when the save changes no mailed fact, or when the only change is the price and payment is not cash. A blank email is `no_email`. A rejection is `failed` and the correction stays. `ResendTransportError` still aborts.
- The price rule uses the payment after the save. A payment-method change always mails, including card switched with invoice-to-agency. Removing cash mails `changed` with no payment line and no sentence in its place.
- A change that returns an accepted Ride to assigned still uses `changed`. The mail does not ask the Driver to accept.
- `PATCH /api/transfers/:id` returns `{ transfer, ride, workOrders }`. The address is not on it. Audit stays `transfer.corrected`, and `ride.returned_to_assigned` when that row is written. No email-sent row.
- The office toast title is `transfers.corrected`. The description is the existing work-order outcome, and it names the Driver.

## Code review

Reviewed uncommitted `feature/168-work-order-correct` against `origin/develop` (`git diff origin/develop`). No commits. After this review, the correction result in `saveCorrection` was renamed from `saved` to `correction`.

## Standards

**Hard:** none.

Checked against `AGENTS.md` (role allow-list, Zod on the route, module `index.ts` imports, audit/log ban on addresses and names), `docs/agents/working-rules.md` (audit append, logger via `server/core/index.ts`, both locales, e2e extended), ADR-0018, ADR-0026 (mail after commit, `changed`, cash-only price, no retry, no email in the result), and ADR-0014 (audit stays `transfer.corrected` / `ride.returned_to_assigned`, ids and field names). `GLOSSARY.md` **Work order** matches that mail rule. The post-commit snapshot plus `deliverAssignedWorkOrder` matches assign, clear, and cancel, so Shotgun Surgery does not apply. `workOrders` as a one-entry array matches `AssignedRide` and `CancelledRideResult`.

**Judgement — Mysterious Name.** `app/components/TransferDay.vue` (`saveCorrection`):

```ts
const saved = correctedTransferResultSchema.parse(await $fetch(...))
```

That local hides `const saved = ref(false)` in the same component. The value is the correction result, not the form flag.

**Judgement — Duplicated Code.** `server/api/transfers.rls.test.ts` adds `workOrderMailer`, then the rejected-send test repeats the same four-method stub with a throwing `sendWorkOrder`:

```ts
mailer: {
  async sendInvitation() {},
  async sendWorkOrder() { throw new Error(...) },
  async notifyArrivalMoved() {},
  async notifyFlightWillNotArrive() {},
},
```

## Spec

### (a)
None.

### (b)
None.

### (c)
None.
