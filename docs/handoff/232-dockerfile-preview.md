Out of scope: migrating on container start, Coolify or server setup, secrets, and backup.

## Decisions

- `ALLOW_CONSOLE_MAILER` must be exactly `1` together with `MAILER=console`. Any other flag value keeps production on `MAILER=resend` and `RESEND_API_KEY`. ADR-0013 is partially superseded by ADR-0037.
- `GET /api/ready` is the container health check. It calls `assertRuntimeRoles` and returns `{ status: 'ok' }` or 503. No session. The probe error is not the response.
- The image does not migrate. `DATABASE_MIGRATE_URL` stays off the container. The owner applies migrations with the owner URL.
- `docker build .` was run locally. It is not a CI job. The spec allows either.

## Code review

## Standards

**Hard.** `docs/adr/0013-invite-email.md` is still `Status: accepted`, and its Decision still says production boot requires `MAILER=resend` and `RESEND_API_KEY`. `docs/adr/README.md` (Format) says a later status is `deprecated` or `superseded by ADR-NNNN`, and that an accepted ADR is superseded rather than left in force. `ADR-0037` changes that boot rule, but `0013` has no supersession line (unlike `0011` and `0014`). The index row says `accepted; preview boot exception in ADR-0037`, which is not that status vocabulary. `AGENTS.md` (Read first) says not to contradict an ADR, and to update an ADR when a decision changes.

**Judgement — Primitive Obsession.** `server/core/readiness.ts` treats a message prefix as the refusal type:

```ts
const detail = error instanceof Error && error.message.startsWith('refusing to start:')
  ? error.message
  : 'readiness check failed'
```

A small error type would carry that. The log line itself matches `docs/agents/working-rules.md` (Logging): the probe error is not the response, and secrets stay off `Error.message`.

**Judgement — Duplicated Code.** `server/core/index.ts` repeats the lazy role probe in `boot` and `assertReady`:

```ts
const { assertRuntimeRoles } = await import('./infrastructure')
await assertRuntimeRoles(env)
```

One helper could own that import. `assertReady` still needs `guardReadiness`.

No other documented breach. Imports stay on `server/core/index` (`ADR-0018`, ESLint boundaries). The ready route returns no tenant data, so the role allow-list and “no session is 401” rules do not apply. `ALLOW_CONSOLE_MAILER === '1'` matches `ADR-0037` (non-`1` must not fail parse). Charter phases 0.3 and 4.2 cover readiness and a Coolify preview.

## Spec

Issue #232 is largely met: multi-stage `Dockerfile` and `.dockerignore`, `GET /api/ready` via `assertRuntimeRoles`, image `HEALTHCHECK`, `ALLOW_CONSOLE_MAILER=1` with a unit test, and preview names in `.env.example` and `docs/ops/preview.md`. The image does not migrate on start.

### (a) Missing or partial

**Deploy notes include values.** Spec: “Document the preview env vars in `.env.example` and the deploy notes (names only, no values).” `.env.example` leaves the assignments empty. `docs/ops/preview.md` still states required settings: `MAILER` `console`, `ALLOW_CONSOLE_MAILER` `1`, and role names (`transferpro_app`, `transferpro_auth`, `transferpro_queue`, `transferpro_platform`).

**`docker build` is not part of CI.** Spec: “`docker build .` succeeds in CI or locally, and the image starts with the app-role URLs.” The Dockerfile is the right shape (pnpm install, `nuxi build`, slim runtime, uid 1001, `CMD` is only the Nitro server). `.github/workflows/ci.yml` is unchanged, so this acceptance is not shown in the diff.

### (b) Scope creep

Spec documentation is only `.env.example` and the deploy notes. The diff also adds `docs/adr/0037-preview-console-mailer.md`, an ADR-0013 index note, and a preview exception in `docs/agents/working-rules.md`.

The 503 entry in `GENERIC_STATUS_MESSAGE` only supports the readiness error body.

### (c) Implemented, but wrong

None. Production without the flag still requires `MAILER=resend` and `RESEND_API_KEY` (`app-env.test.ts`). The flag opts in only when it is exactly `1` and `MAILER` is `console`. `assertReady` calls `assertRuntimeRoles` (DB plus role probe) and `guardReadiness` turns a failure into 503. The healthy RLS case hits the handler; the dead-DB and migrator cases assert that same 503.

After this review: ADR-0013 now has the partial-supersession line, `boot` and `assertReady` share one adapter load, and the deploy table lists names. The mailer sentence in the deploy notes still names `console` and `1`, which is the opt-in the issue specifies. `docker build .` was run locally, not added to CI.

