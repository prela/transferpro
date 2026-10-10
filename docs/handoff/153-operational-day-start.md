# 153 Operational-day start on Tenant settings

Out of scope: late-night dual listing, the roster and expiring documents, a driver’s upcoming Rides, dispatcher warnings, minutes other than :00, rewriting a pickup instant, and the pickup window.

## Decisions

- The operational day stays `localDayBounds` and `operationalDateInTimeZone` in `shared/date.ts`. The third argument is the Tenant hour, default 5. Do not add a second definition of the day. A caller that has loaded Tenant settings passes the stored hour. The default is the Tenant default, not a second cutoff.
- The session shell carries `operationalDayStartHour` beside `timeZone`. The board names its opening date, and the date after a save, from that hour. `listTransferDay` and `loadOfficeHome` pass the same stored hour.
- The column is `operational_day_start_hour`, a required integer 0 through 8, default 5. Audit stores `{ from, to }` as those integers. `HH:00` is display only (`formatOperationalDayStart`).
- A dispatcher and a driver can read the hour and cannot save it. They still do not get Settings → Tenant.

## Code review

Fixed point `HEAD` `429f14abbc9b863c3128c56c677a5bf366b38aac`. The implementation was uncommitted, so the review used `git diff HEAD` plus `db/migrations/0023_operational_day_start.sql` and `db/migrations/meta/0023_snapshot.json`. Both subagents started with `fast=false`.

## Standards

No documented-standard breach. Audit action, `{ from, to }` shape, check migration, both locales, journal `when` (+1000), row RLS on the existing table, Zod on the patch and the session shell, and the board and Home passing the stored hour all match `docs/agents/working-rules.md`, ADR-0015, and ADR-0025. The settings control is a `UFormField` plus `USelect` for a nine-hour list (`nuxt-ui` component-selection). Glossary wording stays "operational-day start." Snapshot `0023` differs from `0022` only in the new column, its check, the enum value, and the shape check.

**Judgement — Duplicated Code.** `hourBound` repeats `minuteBound` with different bounds:

```50:54:db/audit-entry.ts
function hourBound(data: AnyPgColumn, key: 'from' | 'to') {
  const name = sql.raw(`'${key}'`)
  const min = sql.raw(String(OPERATIONAL_DAY_START_MIN))
  const max = sql.raw(String(OPERATIONAL_DAY_START_MAX))
  return sql`(case when jsonb_typeof(${data} -> ${name}) = 'number' and (${data} ->> ${name}) ~ '^[0-9]+$' then (${data} ->> ${name})::integer between ${min} and ${max} else false end)`
}
```

Same for the `HH:00` string: `formatOperationalDayStart` in `shared/tenant-settings.ts` and `operationalStartClock` in `shared/date.ts`.

**Judgement — Data Clumps.** `timeZone` and `startHour` travel together through `localDayBounds`, `operationalDateInTimeZone`, `buildOfficeHome`, and `loadRidesForDay` (`shared/date.ts`, `shared/office-home.ts`). The working rule requires both to be passed; it does not require them to stay separate parameters.

## Spec

### (a) Missing or partial

None. The settings control, 05:00 default, refusal rules, single audit entry, role and tenant checks, board and Home bounds, pickup instant, and the 02:00 daylight-saving rule are all in the diff.

### (b) Scope creep

None. The roster, expiring documents, driver upcoming Rides, pickup window, and Settings → Tenant gate are unchanged. The hour is not stored on the Ride.

### (c) Implemented but wrong

None. The day is a half-open interval from the stored hour in the Tenant time zone, derived on read. A pickup at the hour is included and one minute before it is only on the previous day. Home counts use that interval. Unassigned, waiting, and in-progress lists do not. Hours 2 and 3 go through the existing wall-clock rule.
