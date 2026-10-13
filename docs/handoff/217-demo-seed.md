# 217 Demo seed

Out of scope: onboarding that removes demo data from the product UI, a guided tour, CI or the test harness running the command, a DELETE grant, a migration, an ADR, live flight status, and a second demo Tenant.

## Decisions

- The only seam is `pnpm db:seed:demo`. Guards run before any connection: `DEMO_SEED` must be exactly `1`, then `MAILER` must not be `resend`, then `RESEND_API_KEY` must be unset or blank. Any argument is refused, so a password cannot be passed on the command line.
- The slug is `demo`. Ids are fixed and start `d2170000-0000-4000-8000-`. Emails are `demo-admin@example.com`, `demo-dispatcher@example.com`, and `demo-driver-a@example.com` through `demo-driver-c@example.com`. Driver phones are `555-0100`, `555-0101`, and `555-0102`.
- The password is `DEMO_SEED_PASSWORD` when that variable is non-blank, and it is not printed. Otherwise it is generated and printed once on stdout after both commits. It is not in the repo or in `.env.example`.
- Auth commits before the app rows, because the driver trigger reads membership. The password is printed only after the app commit. A later run replaces the credential again.
- Audit stays append-only. The command does not disable the trigger, does not delete audit rows, and does not write any.
- In-progress rides use the gap car. The valid car is rostered to driver C on the mismatch ride's calendar date, and those pickups can share that date.
- Unit tests assert `decideDemoSeed` only. They do not call the command or read the demo Tenant.

## Code review

## Standards

### Hard

**`server/modules/tenancy/infrastructure/demo-seed.ts` (`replaceApp`)** — ADR-0014: the audit trigger “refuses [DELETE] for every role, the owner included”; “A change needs a reviewed migration that drops or disables the trigger”; “The migrator can [rewrite an entry], but only through a migration someone reviews.” The seed runs `alter table app.audit_entry disable trigger audit_entry_append_only` and then `delete from app.audit_entry`. GLOSSARY.md (Audit entry): an entry “is written with the action and never changed or removed.” GLOSSARY.md (Ride): “A Ride is not deleted.” The same function `delete`s `app.rides`. AGENTS.md (Security): “No destructive DB operations (… mass delete/update …).”

**Same file (inserts)** — ADR-0018: “Another module reaches them only through that module's public `index.ts`.” Tenancy infrastructure inserts `app.clients`, `app.locations`, `app.drivers`, `app.vehicles`, `app.roster`, `app.transfers`, `app.rides`, and `app.ride_alert`.

**Same file (`set_config`)** — `docs/agents/working-rules.md` (RLS and the tenant session): application callers use `openTenantSession`; “Catalog RLS tests may call `set_config`.” ADR-0011: “Callers do not pass `tenant_id`.” The seed calls `select set_config('app.tenant_id', $1, true)` and is not a catalog test.

**`scripts/demo-seed.ts`** — AGENTS.md (Security): “Zod at every runtime boundary (env …).” The script only checks that `AUTH_DATABASE_URL` and `DATABASE_MIGRATE_URL` are not `undefined`. `DEMO_SEED`, `MAILER`, and `RESEND_API_KEY` are never parsed with Zod. (`seedDemoTenant` does `z.url()` the two URLs later.)

### Judgement

**Duplicated Code** — `PASSWORD_LIMITS` and `'Password must be 8 to 128 characters.'` in both `scripts/demo-seed.ts` (`choosePassword` / `main`) and `seedDemoTenant`.

**Duplicated Code** — `new pg.Pool({ connectionString, max: 1 })` in `assertRole`, `assertDemoIdentityIsFree`, and `withClient`.

**Divergent Change** — `demo-seed.ts` is the writer for auth accounts, tenant settings, clients, locations, vehicles, drivers, roster, transfers, rides, alerts, and the audit trigger.

**Duplicated Code** — `demo-seed-picture.ts`: `const OPERATIONAL_START_HOUR = 5`, while `demo-seed.ts` inserts `OPERATIONAL_DAY_START_DEFAULT`.

**Speculative Generality** — `SeedDemoTenantInput.now?` is unused by the script and has no test.

## Spec

### (a) Missing or partial

**Roster mismatch is not only the ride that was meant to show it.** “so that the roster mismatch shows on its own.” The valid car is rostered to driver C on the mismatch pickup’s calendar date, and the two in-progress rides also use that car with drivers A and B. On a normal daytime run those pickups share that date, so the landing-alarm and unclosed rides carry the same mismatch.

**A failed run can store a generated password and not print it.** “print it once, on stdout, after the seed has committed” and “a generated password from a failed run not to be printed, so that I am not given a password that was never stored.” Auth is committed before the app write. If the app write then fails, the new credential is already stored and stdout never shows it.

### (b) Scope creep

**Any command argument is a fourth refusal.** “Refuse unless `DEMO_SEED` is exactly `1`. Refuse when `MAILER` is `resend`. Refuse when `RESEND_API_KEY` is set to a non-blank value.” `decideDemoSeed` also returns `no-arguments` whenever `argv` is non-empty. “Never take it as an argument” covers a password, not every flag.

**Stops the spec does not name.** “If any of those emails is already a member of a different Tenant, the command stops and leaves the database unchanged.” The command also stops when the demo id belongs to another slug, or a demo user is the inviter for another tenant, and when the email exists on a different user id with no membership.

**A caller can freeze the clock.** “All instants and calendar dates are derived from the time the command runs.” `SeedDemoTenantInput.now` is optional. The command does not pass it. Tests are not supposed to call this command.

### (c) Implemented, but wrong

**In-progress rides are the roster mismatch as well.** “one in-progress airport Ride with a stored landing” and “a second in-progress Ride with no flight and no landing” should be the landing alarm and the unclosed mark. Both use the valid car. Combined with the roster row above, a daytime board does not show those marks alone.

**Driver phones are not reserved fictional numbers.** “Driver phones, where the Driver record requires one, are reserved fictional numbers.” The stored values are `555-010-0001`, `555-010-0002`, and `555-010-0003`. The reserved block is numbers whose exchange is 555 and whose line is 0100–0199.
