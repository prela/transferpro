# 387 ExternalRef and idempotent create

Out of scope: the form that mints and sends the key stays in step 15b; making the key required stays in 15c-iii.

## Decisions

- A repeated manual `externalId` is settled with `ON CONFLICT DO NOTHING` on `(tenant_id, channel, external_id)`, then a read of the stored Transfer and Ride in the same Tenant session. The conflict writes no row, so the audit entry and any job are not reached.
- `alreadyRecorded` lives on the create result only. A correction still returns the booking and the Ride without that flag, and its body schema has no key.
- `channel` and `external_id` are stored and never selected into a response. The repeat log line is `transfer.already_recorded` with the Transfer id only.
- The review's hard note against ADR-0035 is the slice boundary. This ticket keeps the key optional and assigns one when the body omits it. The form that sends the key is the next step.

## Code review

## Standards

**Hard.** ADR-0035, “Idempotent manual entry”: the form mints a UUID when it opens, keeps it in the draft, and sends it in the body, so a double submit, retry, or reload stores one Transfer. This diff makes the key optional and, when it is absent, assigns a new id and skips the lookup.

```410:417:shared/transfer.ts
 * optional in this ticket: absent means the server assigns one, and that
 * create is not idempotent.
export const createTransferSchema = transferBookingSchema.extend({
  externalId: z.uuid().optional(),
```

```91:96:server/modules/transfers/infrastructure/transfers.ts
  const storedExternalId = externalId ?? randomUUID()
  if (externalId !== null) {
    const existing = await loadManualTransfer(transaction, externalId)
```

`server/api/transfers.rls.test.ts` asserts that a body without the key still records a second Transfer. No form or draft change is in the diff, so the office post still takes that path. Migration `0052`, the unique `(tenant_id, channel, external_id)` index, audit and log omission, correction refusal, and the journal `when` (+1000) match ADR-0035 and `docs/agents/working-rules.md`.

**Judgement.**

- **Middle Man** (`shared/transfer.ts`): `parseCreateTransfer` only forwards and drops the key. “`externalId` is accepted and dropped here; `parseRecordTransfer` is what keeps it.”
- **Duplicated Code** (`server/modules/transfers/infrastructure/transfers.ts`): `loadManualTransfer` repeats the `transferColumns` list (`id`, `clientId`, `pickupAt`, … `clientReference`) and rebuilds the Ride beside it.

Shotgun edits that add `external_id` to inserts follow ADR-0035 (“every test, fixture, and seed … has to supply an `external_id`”). `external_id` stays `text` and `channel` stays the constant `manual` because that ADR defers a `BookingSource` type.

## Spec

No missing, partial, extra, or incorrect requirements against issue #387.

**(a)** The migration, optional uuid `externalId`, server-assigned id, `alreadyRecorded` on HTTP 200, unique-key conflict path, `transfer.already_recorded` with `transferId`, role check before the tenant-session lookup, strict correction body, omitted columns, fixture `external_id`s, and the listed RLS cases are all in the diff. Raw-insert edits do not change assertions. No test is removed or weakened.

**(b)** No product behaviour beyond the issue. Schema split, `alreadyRecorded`, and the conflict read are what the acceptance criteria require.

**(c)** The checked paths match the spec: `channel` stays `manual` with `transfers_channel`; `external_id` is filled by `gen_random_uuid()::text` and that default is dropped, with no `UPDATE`; the unique index is `(tenant_id, channel, external_id)`; a repeat returns the stored Transfer and Ride and does not insert, audit, or enqueue; a different payload is not applied; neither column is selected into create, correction, day list, search, export, or the day-list row the Ride detail uses.
