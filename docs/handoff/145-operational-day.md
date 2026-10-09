# 145 Operational day on the board

Out of scope: the office Home snapshot (#146), the unassigned alarm, and a configurable cutoff.

## Decisions

- The Ride day bound is `localDayBounds` in `shared/date.ts`: local 05:00 inclusive to the next local 05:00 exclusive, in the Tenant time zone. The calendar date that names that day is `operationalDateInTimeZone`. #146 must use both. Do not use `calendarDateInTimeZone` for a Ride day.
- The name `localDayBounds` still says local day. It is the operational day. The roster and expiring documents stay on `calendarDateInTimeZone`. Do not call `localDayBounds` from those paths.
- A missing date on `GET /api/transfers`, and the date the board opens on, are the operational day that contains now, including before 05:00. `listTransferDay` takes that clock as its third argument so a test can pin the instant.
- Recording a pickup is unchanged, including the 30-day window. The form still defaults to noon on the calendar date. After a save, the board shows the operational day of that pickup.
- No migration and no new copy.
- An e2e Ride that must show on the open board is seeded on that operational day, at 05:00 or later. Noon on the calendar date is the next operational day when now is before 05:00, and a reload of the board does not list it. The roster key for that seed stays the calendar date, which matches because the clock is after 05:00.

## Code review

Fixed point `feature/115-office-home-bf0e` (`9fcc7bf`). One commit, `5077983`.

## Standards

Ref `feature/115-office-home-bf0e` (`9fcc7bf`) resolves. The three-dot diff is non-empty: `5077983` only.

**Hard documented breaches: none.** ADR-0021 holds in the callers that matter: the board uses the 05:00 bound (`localDayBounds`, `operationalDateInTimeZone`); the roster (`assign.ts`) and expiring documents still use `calendarDateInTimeZone`. `listTransferDay` still takes the tenant from `withTenantFromSession` and still runs `officeOnly` (ADR-0011, AGENTS.md role allow-list). No new log line or audit payload (ADR-0012). Transfers stay behind `index.ts` (ADR-0018). The UI change adds `e2e/operational-day.spec.ts` and no new copy, so the both-locales rule does not apply. `e2e/operational-day.spec.ts` imports `../shared/date` the same way the other specs do; lint does not cover that path, so it is not counted.

**Judgement call — Mysterious Name** (`shared/date.ts`). The glossary term is operational day (avoid “calendar day” and “midnight”; AGENTS.md: use glossary terms in code). The bounds function still says local day while it now returns 05:00–05:00:

```103:109:shared/date.ts
export function localDayBounds(day: string, timeZone: string): { start: Date, end: Date } {
  // ...
  return {
    start: instantFromWallClock(`${day}T05:00`, timeZone),
    end: instantFromWallClock(`${addCalendarDays(day, 1)}T05:00`, timeZone),
  }
}
```

`operationalDateInTimeZone` is named for the concept; this function is not. The comment has to warn that the roster must not call it.

That overloaded name is why `server/api/rides.rls.test.ts` dropped `localDayBounds` and rebuilt roster midnight with `instantFromWallClock`: “The roster keeps that calendar date. The Ride day bound is 05:00 and is not used here.” Rename the bounds helper to the operational day; leave a calendar-midnight helper if the roster still needs one.

## Spec

Fixed point `feature/115-office-home-bf0e` resolves (`9fcc7bf`). The diff is non-empty: `5077983`, 13 files.

**(a) Missing or partial:** none. The board lists a half-open operational day, local 05:00 inclusive through the next local 05:00 exclusive, named by the date of that start. A missing date and the board’s initial date are the operational day that contains now, including before 05:00. 04:59 and 00:30 stay on the previous day only; 05:00 starts the new day. The 23-hour night (28–29 March 2026) and the 25-hour night (24–25 October 2026) still end at local 05:00. The roster and expiring documents still use the calendar date and the 30-day window, and they do not call this bound. The pickup window and the stored instant are unchanged. Admin and Dispatcher can list the day; a Driver is still refused. Tenant isolation is unchanged. There is no migration and no copy change.

**(b) Scope creep:** none. The clock argument on the day list exists so the default-before-05:00 case can be fixed. After a save, the board follows the recorded pickup’s operational day.

**(c) Implemented but wrong:** none. The query is `pickup_at >= start and pickup_at < end` with those 05:00 instants, including the daylight-saving bounds.
