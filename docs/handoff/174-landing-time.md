# 174 Landing time

Out of scope: the expected-arrival notice, the will-not-arrive notice, a flight-status vendor, and the screen that types a landing time.

## Decisions

- `landing_at` is on the Transfer. The feed writes it only while it is empty, the chosen arrival is `landed` at the pickup IATA code, and the instant is not after now. The Ride state is not updated. There is no audit entry for that write.
- The arrival kept is the closest within 6 hours. An instant inside that window is on the pickup's calendar date or the day on either side in the Tenant zone. If that closest arrival is at another airport, or two are equally close, nothing is stored.
- `app.tenants_due_flight_landing` returns Tenant ids only. The schedule opens one session per id. The job payload is empty and carries no request id. The status port in this process returns an empty list; a vendor is a later ticket.
- `recordLandingTime` refuses a future instant and a finished Ride. It has no HTTP route. #27 owns the screen, the roles, and the audit.
- After review, the unused notice port was removed. #175 and #176 add the moved and will-not-arrive facts.

## Code review

## Standards

### Hard

**`db/migrations/0027_flight_landing.sql` — ADR-0011.** `app.tenants_due_flight_landing` is `SECURITY DEFINER` and `GRANT EXECUTE` is given to `transferpro_app`. ADR-0011 gives that role no `BYPASSRLS`: a tenant read runs only after `app.tenant_id` is set, and a missing predicate returns no other tenant’s rows. This function reads every tenant’s transfers and returns their ids with no session. `search_path` is pinned, which matches the audit functions, but those are the only `SECURITY DEFINER` functions ADR-0014 and ADR-0019 allow, and they live in schema `audit`.

**`server/modules/transfers/infrastructure/flight-landing-worker.ts` — ADR-0011, ADR-0004, `docs/agents/working-rules.md` (RLS and the tenant session).** The worker builds `{ tenantId }` from that function and passes it to `openTenantSession`. ADR-0011 mints a `TenantContext` from the session or from a queue envelope stamped at enqueue; callers do not choose `tenant_id`. Working rules: the envelope stores `request_id` beside `tenantId`, and the handler restores it with `runWithRequestId` before `openTenantSession`. This job has an empty payload and never does that. ADR-0004: jobs are reached through a port, and domain/application code does not import pg-boss. Lint allows the import from `infrastructure/`, but this file constructs a second `PgBoss` (`schedule` / `work`) beside `createPgBossJobQueue` in `server/core/infrastructure.ts`, so the envelope path is skipped.

**`server/modules/transfers/infrastructure/flight-landing.ts` — ADR-0028.** `FlightNoticePort`, `noFlightNotice`, and the `notices` argument on `refreshFlightLandings` / `askFlightLandings` are never called. ADR-0028: the notice is a later use of the ADR-0026 port, and this decision does not add an adapter. A landing write sending nothing is already the rule; a second port is not.

### Judgement

**Duplicated code.** The designator shape is written twice: `shared/flight-landing.ts` `designatorPattern` (`/^([A-Z]{2,3}) ?(\d{1,4})$/i`) and the migration predicate `t.flight_number ~ '^[A-Za-z]{2,3} ?[0-9]{1,4}$'`.

**Mysterious name.** `recordLandingTime` throws `LandingTimeClosedError` (`'Landing time cannot change after the Ride is finished.'`) when the ride row is missing, not only when `finished` contains the state.

**Middle man.** `flightAskEveryMinutes()` only returns `FLIGHT_ASK_EVERY_MINUTES`.

## Spec

### (a) Missing or partial

The date window is only a query. `chooseFlightArrival` never sees the Tenant time zone or the three dates, so a returned arrival is not required to fall on the pickup’s calendar date or the day on either side.

> “The arrival used is the one closest to the pickup instant among the pickup’s calendar date and the day on either side, in the Tenant’s time zone, and only when it is within 6 hours of the pickup.”

### (b) Not asked for

`recordLandingTime` rejects a record or a clear once the Ride is done, no-show, or cancelled (`LandingTimeClosedError`). The person path in this ticket is only the future-instant refusal. The typing screen is out of scope.

> “A landing time that is still in the future is refused, for a person and for the feed, and the stored value is unchanged.”
> “No flight-status vendor is added, and the typing screen for a landing time is not added.”

`FlightNoticePort` (`moved`, `will-not-arrive`) is passed through the ask and never called. Those notices are #175 and #176.

### (c) Looks done, but wrong

Closeness is ranked across every row, including other airports and rows that have not landed. Only the single closest row is then checked. A nearer arrival at another airport, or a nearer expected, cancelled, or diverted row, returns `elsewhere` or `none`, and a landed arrival at the pickup airport inside 6 hours is not stored.

> “A qualifying Ride stores a landing time when the status says the aircraft has landed, the landing time is empty, and the actual instant is not after now.”
> ADR-0028: “The arrival airport must match the pickup Location’s IATA code.”

The finished-Ride lock also conflicts with ADR-0028: “A person may still record or clear it under ADR-0007.”
