# AGENTS.md

Instructions for Cursor agents working in the `transferpro` repo.

## Read first, in this order

1. `CHARTER.md` — goal, scope, v1 slice, rules, WBS. Owner-locked.
2. `CONTEXT.md` — glossary. Use its terms in code, tests, and tickets (Transfer vs Ride, Client vs Partner, Tenant).
3. `docs/adr/` — accepted decisions. Do not contradict an ADR; propose a new one.
4. The GitHub issue for your WP.

## Hard rules

- **Tenant isolation:** every tenant table has `tenant_id` and an RLS policy, plus a test proving Tenant A cannot read or write Tenant B's rows. No exceptions without an ADR.
- **No production access.** Never connect to, deploy to, or read secrets of production.
- **No destructive DB operations** (drop, truncate, mass delete/update, destructive migrations). Every migration goes in the PR for owner review; never apply it outside local/test DBs.
- **No deep imports** across modules or Tiers. Import only from a module's `index.ts`. Domain/application never import Drizzle, Better Auth, Nuxt, or the queue directly; they use ports.
- **Tests first.** Red before green for domain and application code. Lint and typecheck 0 errors; coverage 80% global, 95% domain + application services.
- **Zod at every runtime boundary** (env, request bodies, query params, imported bookings).
- **One WP = one `feature/<wp>-<slug>` branch = one PR into `develop`.** Never commit to `develop` or `main`. Claim a WP only when its dependencies are merged.
- **Conventional Commits.** Do not hand-edit `CHANGELOG.md`; it is generated.
- **Blocked? Stop.** Write what blocks you on the ticket; do not start another WP, do not guess.
- **Never edit `CHARTER.md`** without owner approval: propose a diff, reason, and impact, then wait.
- Stay inside v1 scope. Non-goals in the Charter are out of bounds unless a WP says so.
- No global installs; use repo scripts only.

## Skill workflow

1. **Wayfinder** — project → WPs as GitHub issues (done once, refreshed when scope changes).
2. **grill-with-docs** — per piece; update `CONTEXT.md` and write/update ADRs.
3. **architect** (pstack) — per WP: types, signatures, module structure. **Owner approves before code.**
4. **tdd** — implement red–green–refactor; open one PR.
5. **blast-radius** — before merging anything touching auth, RLS, migrations, jobs, or shared schemas.

## Commands (placeholders until WP 0.2)

```bash
pnpm install
pnpm dev              # local app
pnpm lint             # Antfu ESLint, 0 errors
pnpm typecheck        # vue-tsc / nuxi typecheck, 0 errors
pnpm test             # Vitest unit + integration
pnpm test:coverage    # coverage gates
pnpm test:e2e         # Playwright
pnpm db:generate      # Drizzle migration (commit for review; do not apply to shared DBs)
pnpm db:migrate:local # apply to local Docker DB only
docker compose up -d  # local Postgres
```

## Definition of done (per PR)

- Tests written first and green; lint, typecheck, coverage pass in CI.
- RLS tests for any new tenant table.
- `CONTEXT.md` / ADR updated if a term or decision changed.
- PR description: WP id, what changed, what it could break, migration notes.
