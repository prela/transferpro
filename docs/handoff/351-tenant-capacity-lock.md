# 351 Tenant capacity lock

Out of scope: the Capacity module extraction, unavailability windows, the handoff, fully booked, and the shared unclosed threshold (#352).

## Decisions

- `lockTenantCapacity` in `ride-schedule.ts` is `pg_advisory_xact_lock(34, hashtext(current_setting('app.tenant_id')::uuid::text))`. The two-key form keeps it apart from the one-key member lock (`hashtext(organizationId)`, ADR-0014). The Tenant is the session setting, never a bound request value. A session with no Tenant fails the uuid cast instead of locking nothing. No timeout.
- Callers: assign, a Vehicle change, a reassignment, and a Transfer correction only when `occupiedWindowMoves` returns the Driver and Vehicle. Each takes it after `lockTransferRide` or `lockTransfer`, `stale_save`, the state refusal, and the same-Vehicle or same-Driver refusal, and before the Driver, Vehicle, or occupation read. The correction takes it after the Client and Location checks and the no-op return, before the booking write.
- The occupation read moved to `ride-occupation.ts` (`readOccupyingRides`) and lost `for share`. It is a separate file so `ride-change.test.ts` can spy on it with `vi.mock(..., { spy: true })`. It is not the ADR-0034 port yet.
- The Driver and Vehicle `for share` reads stay. They guard the archive and must-accept races, and their RLS tests in `server/api/rides.rls.test.ts` are unchanged. Those writers lock only their own row and take no Tenant lock, so no cycle forms.
- The concurrency tests live in `server/modules/transfers/infrastructure/capacity-lock.rls.test.ts`, because they hold `assignUnassignedRide` open and that function is not on the module index. They call the routes, as `tenant-session.rls.test.ts` does. A case is `waited` when `pg_blocking_pids` names the held backend before the route answers, and `answered` otherwise. No lock call is asserted.
- Before this change the correction case already waited, but on the other Ride's `for share` row lock. With the Tenant lock removed from the correction only, that case goes red.
- `hashtext` is 32 bits, so two Tenants could share a key and wait on each other. The member lock has the same limit.

## Test edits flagged

- `assign.test.ts` and `ride-change.test.ts`: the fake matches the occupation read on `app.rides` plus `r.state in` instead of `for share`. The overlap test's `find` uses the same matcher. Its assertions are unchanged.
- `ride-change.test.ts`, clear: the `for share` text check is now `expect(readOccupyingRides).not.toHaveBeenCalled()`. The `landing_at` assertion stays.
