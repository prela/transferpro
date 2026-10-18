# 336 Ride CSV export

Out of scope: other formats, other catalogues, extra columns (guest, flight, note, tabla), scheduled or emailed exports, and invoicing.

## Decisions

- The range is inclusive calendar days, at most 366. `from` after `to`, or `addCalendarDays(from, 365)` before `to`, is 400 with the fixed message `Bad request`.
- Bounds are local midnight, half-open. They are not the operational day. A Ride at 02:00 stays on that calendar date.
- The CSV writes `dd.mm.yyyy` and `HH:mm` from `wallClockInTimeZone`. `formatInstant` stays the screen writer. The ticket requires the Excel shape.
- English place headers stay Pickup and Drop-off. The last English column is Status.
- After QC, a text cell that starts with tab or CR gets the same leading `'` as `=`, `+`, `-`, and `@`. The price cell is never prefixed.
- No migration, no RLS change, and no audit entry. The log line is member id, range, and row count.

## Code review

Fixed point `origin/develop`. The reports below are the review of `1f2704e`.

## Standards

### Hard

**`shared/ride-export.ts` `dateAndTime`.** `docs/agents/working-rules.md` (i18n): render instants with `formatInstant`; do not add another date formatter. This formats a pickup instant into `dd.mm.yyyy` and `HH:mm` via `wallClockInTimeZone`, and the comment sets `formatInstant` aside as the screen writer. `clockLabel` in `shared/live-refresh.ts` already takes the clock from `formatInstant`.

**Glossary terms.** `AGENTS.md` requires glossary terms in code and tests. `GLOSSARY.md` avoids “place” for Location and “firm” for Tenant. `server/modules/transfers/infrastructure/ride-export.ts` names the location map `places` and the row `place`. `server/api/transfers-export.rls.test.ts` names the tenants `firmA` and `firmB`.

### Judgement

**Duplicated Code.** Payment and state labels are copied beside the locale files:

```ts
const payments: Record<DisplayLocale, Record<PaymentMethod, string>> = {
  hr: { cash: 'Gotovina', card: 'Kartica', invoice_to_agency: 'Račun agenciji' },
  en: { cash: 'Cash', card: 'Card', invoice_to_agency: 'Invoice to agency' },
}
const states: Record<DisplayLocale, Record<RideState, string>> = { /* same words as i18n */ }
```

Those words already live in `i18n/locales/hr.json` and `en.json` (`transfers.payments`, `transfers.states`). The unit test re-reads the JSON to prove they match, so a label change is two edits.

**Duplicated Code.** The download name is built twice. `rideExportFilename` returns `` `rides-${from}-${to}.csv` ``, and `RideCsvExport.vue` `filenameFrom` parses that same pattern out of `Content-Disposition`, then falls back to `` `rides-${from.value}-${to.value}.csv` ``.

## Spec

### (a) Missing or partial

None. The diff covers the GET route and office role check, Zod calendar dates with one 400 for a reversed range or a range over 366 days, calendar-day rows in pickup order (including 02:00), the ten columns, UTF-8 BOM / `;` / CRLF / quoting / decimal comma, hr and en headers, states, and payment methods, the formula guard `/^[=+\-@\t\r]/` on text only, attachment filename plus `Cache-Control: no-store`, module entry points and a pure `shared/` builder, no audit and one log line (`userId`, `from`, `to`, `rowCount`), and the Croatian/English dialog in light and dark with labelled dates that submit on Enter. Builder, route, and e2e tests match the test list.

### (b) Scope creep

None. No other format, catalogue, extra column, schedule, or invoice path. IATA on an airport Location is the existing Location label, not a flight column.

### (c) Implemented but wrong

None. Inclusive 366-day math matches “over 366 days.” The price cell is only the decimal comma. Driver and Vehicle are empty when unassigned. Locale follows the user, then the Tenant default.
