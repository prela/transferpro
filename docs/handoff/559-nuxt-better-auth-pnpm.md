# 559 Nuxt 4.6.4, nitropack 2.13.6, Better Auth 1.7.18, pnpm 12.18.0

Out of scope: Docker Engine host updates, postgres.js, Better Auth 1.8, h3 2, and a blanket dependency update.

## Decisions

- Nuxt is `^4.6.4`. The lockfile resolves `nuxt@4.6.4`. `nitropack@2.13.6` comes through `@nuxt/nitro-server@4.6.4`. It is not a direct dependency. One nitropack version is installed.
- pnpm is `12.18.0` in `packageManager`, `engines.pnpm` (`>=12.18.0 <13`), and every CI `pnpm/action-setup` pin. The floor moves with the pin so a 12.16 install, which still has the generated-file mode bug fixed in 12.17, is outside the engine range.
- Better Auth and `@better-auth/drizzle-adapter` are `^1.7.18`. Direct transitives move with that line (`@better-auth/*` 1.7.18). No `socialProviders`, no cookie cache, no secondary storage, no email OTP, no phone plugin, no 2FA, no device authorization, and no custom access-control statement. No Drizzle migration.
- Vue stays `^3.5.43` in `package.json`. The single-copy override moves from 3.5.44 to 3.5.45, and the lockfile resolves `vue@3.5.45`. Vite stays an override of `^8.3.3` and the lockfile resolves `vite@8.3.6`.
- `trustPolicy` stays `no-downgrade`. The lockfile resolves `seroval@1.7.7`, which passes that policy, so the old `seroval@1.7.2` exclude is removed. `semver` stays excluded.
- `node-forge` is overridden to `>=1.4.1` (resolved 1.4.3). listhen still asks for `^1.4.0` and was locking 1.4.0. That release is vulnerable through 1.4.0, including GHSA-86w9-cpqp-85rv, so that ignore is removed. Drop the override once listhen depends on `>=1.4.1`. The package stays on the dev-server cert path.
- Age-gate excludes roll to Better Auth 1.7.18, pnpm 12.18.0, Nuxt 4.6.4, and Vue 3.5.45. Drop each line once that version installs without an exclude.
- `vue-router@5.4.0` remains beside the app's `5.3.1`. That split was already on `develop` because Nuxt depends on `vue-router@^5.4.0`. This slice does not change the `vue-router` range.

## Nuxt 4.6.4 checks

1. **Untrusted error details.** Production SSR error payloads now keep `message` and `data` only for `createError`. API responses already go through `server/error.ts`, which replaces the thrown message with a fixed status phrase and forwards a machine `code` only from `createError` data. Route handlers that the client reads throw `createError`. Plain `Error` throws in tenancy helpers (`Account identity is missing.`, and the locale and tenant-name misses) are not client copy; no test asserts those strings. No handler was switched. `/api/ready` and the error body shape are unchanged.
2. **`devServer.allowedHosts`.** The new Host rejection is the webpack and rspack dev servers. This app uses the Vite dev server, which already checked Host. Dev is `localhost:3000`. Preview runs the production server, not the dev server. The option is unset.
3. **Cached non-GET route rules.** `routeRules` sets headers on `/manifest.webmanifest` and `/sw.js` only. There is no `cache`, `swr`, or `isr` rule.
4. **`x-forwarded-proto`.** Nuxt no longer treats that header as HTTPS unless the app opts in. This app does not read the request protocol. Secure cookies follow `NODE_ENV=production`. Better Auth uses `BETTER_AUTH_URL`. No opt-in was added.

## Better Auth 1.7.16 / 1.7.17 / 1.7.18 checks

1. **Revoked sessions via cookie cache or secondary storage.** Neither `session.cookieCache` nor `secondaryStorage` is set. Sessions are rows in Postgres. Revoke deletes those rows (`revokeSessionsOnPasswordReset`, password-change cleanup, and `deleteSession`). The library fix is in the bump; this app has no cache path that could replay a revoked session.
2. **OAuth `email_verified: "false"`.** No `socialProviders`. `email_verified` is set true only by the invitation insert, which copies the address from the invitation row.
3. **Trusted-origin wildcards.** `trustedOrigins` is unset. There is no host or IP wildcard to reject.
4. **Email OTP `allowedAttempts`.** Email OTP is not enabled.
5. **`user:set-phone`.** Roles use Better Auth's default organization controller and grant `invitation` only. There is no custom statement and no admin phone update. Nothing to add.
6. **`session.delete.after` during revoke-all.** `secondaryStorage` and `storeSessionInDatabase` are unset. The hook that would mis-label sessions is not configured.
7. **Device authorization cookie cache.** Device authorization is not enabled.
8. **Phone plugin empty number.** The phone plugin is not enabled.
9. **2FA trusted devices on other login paths.** 2FA is not enabled.
10. **Revoke-all while new sessions are created.** Same as check 6: no secondary storage. The 1.7.18 refinement does not apply to this configuration.

## Verification

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (1115 tests). `pnpm audit --audit-level=high` exited 0.
- `pnpm install --frozen-lockfile` was not run here: the shell guard refuses `pnpm install`. The Dockerfile is that command, not `pnpm deploy`. Each lockfile write was pnpm 12.18.0 and passed the supply-chain check, including after the `seroval@1.7.2` exclude was removed.
- RLS and e2e were not run. This slice does not change tenant tables or session code. CI still has to run both.
