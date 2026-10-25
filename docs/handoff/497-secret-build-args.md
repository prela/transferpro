# 497 Secret build args

Out of scope: a Coolify preview deploy, and adding `docker build` to CI.

## Decisions

- `origin/develop` already declared no secret `ARG`. `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_DATABASE_URL`, `MAPS_API_KEY`, and `MAPS_EMBED_KEY` are read at boot by `parseAppEnv`. Nitro replaces `process.env.NODE_ENV` only. A `nuxi build` with sentinel values did not write them into `.output`. No BuildKit secret mount.
- `NODE_ENV=production` stays an `ENV` on the runtime stage. It is not a build `ARG`.
- The check fails on those five names as Dockerfile `ARG`/`ENV`, in `docker history`, and in `.output/public`. It fails on a supplied value anywhere in `.output` or history. The server bundle may still spell the key, because that is the runtime read. Findings do not include values.
- `SENTRY_DSN` is documented as runtime only. It is not one of the five names in the check. `nuxt.config.ts` copies it into client runtime config when it is set while the config loads.
- `docker build` with those names passed as unused build-args logged no `SecretsUsedInArgOrEnv`. The image scan exited 0. The image was removed after the scan.
- Conclude: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (1003) passed. `pnpm test:e2e` passed (349). No migration.

## Code review

## Standards

No hard breaches. Logging matches `docs/agents/working-rules.md` (Logging and errors: do not log secret values): findings name the variable or the file, and the tests assert the sentinel and `super-secret` stay off stdout and stderr. `AGENTS.md` (never weaken or remove a test; Zod at env, request bodies, query params, and imported bookings; module `index.ts` only) does not apply: tests are new, this slice does not parse those boundaries, and the scripts do not cross modules. Error text follows `scripts/e2e-database.mjs`: name the variable, never the value. "Client bundle" is the browser output, not glossary Client.

**Judgement — Duplicated Code** (`scripts/image-secrets.mjs`). The same name boundary is written twice:

```js
return new RegExp(`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`)
const declared = new RegExp(`^(?:ARG|ENV)\\s+${name}(?![A-Z0-9_])`)
const laterEnv = new RegExp(`^ENV\\s+\\S+\\s+${name}(?![A-Z0-9_])`)
```

The same five names are also copied in the Dockerfile comment, `docs/ops/preview.md`, and `SECRET_BUILD_NAMES`.

**Judgement — Mysterious Name** (`dockerfileLeaks`). `laterEnv` matches `ENV <other> <secretName>`, not a later `ENV` instruction.

## Spec

### (a) Missing or partial

**`SENTRY_DSN` is inlined at build and is not in the check.** `nuxt.config.ts` reads `SENTRY_DSN` and `SENTRY_RELEASE` while the config loads and copies them into `runtimeConfig.public`. `docs/ops/preview.md` says to leave `SENTRY_DSN` off the build. `SECRET_BUILD_NAMES` is only the five problem names, so an `ARG`/`ENV` `SENTRY_DSN`, that name in `docker history`, or the name in `.output/public` does not fail. A value is caught only if it is passed in `--values-file`.

Spec: "Check whether any secret is inlined into .output." Spec: "Add a check that fails if any secret value or name appears in the built .output or in docker history."

**The check does not gate a build.** Nothing in the Dockerfile, package scripts, or CI runs `assert-image-secrets.mjs`. `docs/ops/preview.md` shows a manual command, and omitting `--values-file` skips values. "Done when" is not enforced: "docker build shows no SecretsUsedInArgOrEnv warnings." "The built image contains no secret values."

The five ARGs were already absent on `origin/develop`. Comments plus the Dockerfile `ARG`/`ENV` scan cover that. `NODE_ENV=production` stays an image `ENV` on the runtime stage (unchanged). The diff treats it as not a secret and not a build arg, which matches the current Dockerfile.

### (b) Scope creep

None. The scan scratch ignore rules, the Dockerfile instruction scan, and the 8-character value floor only support the check. The `SENTRY_DSN` note belongs to "Document in docs/ops/ which Coolify variables are runtime only."

### (c) Implemented but wrong

No defect in the client-only name scan. The server bundle must keep the key strings to read `process.env` at boot. The scan still fails on those five names in `.output/public`, on any supplied value anywhere under `.output`, and on a name or value in `docker history`. Spec: "Add a check that fails if any secret value or name appears in the built .output or in docker history."

Other Coolify secrets in the same table (`DATABASE_URL`, `RESEND_API_KEY`, and the other database URLs) are documented as runtime only and are not name-scanned. That matches the five names in the problem statement, not a wrong implementation of those five.
