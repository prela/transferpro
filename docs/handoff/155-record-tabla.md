# 155 Record a tabla on a Transfer

Out of scope: a Driver’s upcoming Rides, an image or file upload, a tabla on the Client, and editing a Transfer after it is recorded.

## Decisions

- `tabla` is text on the Transfer. A blank is `''`, not null. It is trimmed, at most 200 characters, and separate from `guestName` and `note`.
- The audit entry may include the field name `tabla` only when the stored text is non-empty. The words stay off the entry and off logs (`tabla` is a redact key).
- The day list shows the text when it is non-empty and an empty cell when it is not. Office home omits the line when it is empty. The Driver upcoming list does not select it.

## Code review

Fixed point `origin/develop` (`1c0b950`). One commit, `f10dad8`. Diff `git diff origin/develop...HEAD`. Both subagents started with `fast=false`.

## Standards

No hard violations.

Checked against `AGENTS.md`, `docs/agents/working-rules.md` (audit, RLS, migrations, logging, i18n), ADR-0011, ADR-0014, `GLOSSARY.md`, and the Nuxt UI form/table rules. The column stays on `tenantTable('transfers')`; `0024` only adds a column to a table that already has FORCE RLS and a table-level grant. Journal `when` is the previous entry plus 1000. `transfer.created` still stores the field name `tabla`, not the words; the shape check is replaced and the length bound is 11. `tabla` is on the redact list, with a logger test. Both locales have the label and the audit field name. The input is `UFormField` plus `UInput`, labeled, `size="xl"`, same as the other fields. Zod parses the body and the row.

Shotgun surgery is suppressed. Working rules require the migration, the audit check, both locales, the redact key, the glossary line, and a Tenant A/B proof.

**Judgement calls**

- **Duplicated Code** — `server/modules/transfers/infrastructure/transfer.rls.test.ts`. `transferInsert` still omits `tabla`, and the tenant-isolation test pastes a second insert that adds it:

```124:129:server/modules/transfers/infrastructure/transfer.rls.test.ts
      `insert into app.transfers (
        client_id, pickup_at, start_location_id, end_location_id,
        passenger_count, guest_name, flight_number, price, payment,
        airport_mark, luggage_count, child_seat_count, note, tabla
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
```

- **Mysterious Name** — `e2e/office-home.spec.ts`. The helper argument is still `fare` after it gained the meet sign: `fare: { price, payment, flightNumber?, tabla? }`.

## Spec

### (a) Missing or partial

None. Recording trims an optional tabla and stores a blank as `''`, capped at 200 characters. It is its own column and input, separate from the guest name and the note. The form has one text input labeled Tabla / Meet sign. The day list renders the text only when it is non-empty. Office home adds a Ride-facts line only when it is non-empty. The audit entry may include the field name `tabla` and does not store the words. Logs redact the `tabla` key. The column sits on `transfers`, which already has tenant isolation, and a Tenant B read returns no row. No file or image input was added.

### (b) Scope creep

None. The glossary line, the too-long messages, the audit-constraint rewrite, and the redaction key are the same rules as “A blank is stored as empty,” “The Croatian label is Tabla. The English label is Meet sign,” and “The audit entry may name the field when a tabla was stored, and does not store the tabla text. Logs follow the same ban.”

### (c) Implemented but wrong

None. Empty tabla stays off the audit field list (`!== ''`), which matches “may name the field when a tabla was stored.” A blank day-list cell versus an omitted office-home line matches the two display lines as written.
