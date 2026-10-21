# 406 dependency upgrade

Out of scope: the Node base image bump, Better Auth 1.8 beta, and TypeScript 7.1.

## Decisions

- ID-token sign-in is not used. `createAuth` has no `socialProviders` and nothing calls social or ID-token sign-in. `auth.account.id_token` is the Better Auth account column, not that sign-in path. No provider `clientId` was added.
- h3 stays 1.15.11. Nuxt 4.6.2 and Nitro 2.13.5 depend on `h3` `^1.15.11`. h3 2.0.x is a separate major. Forcing it would either duplicate majors or leave the server on a line Nitro does not declare. One copy of nuxt, h3, and nitro. `nitropack` is 2.13.5. `better-auth` and `@better-auth/drizzle-adapter` are `^1.7.12`.
- Better Auth 1.7.12's organization plugin schema matches `db/auth-schema.ts`. Teams and dynamic access control are off, so `teamId` and `organizationRole` are not part of this app. No Drizzle migration. The 1.7.11 Postgres `int8` rate-limit diff does not apply: this app does not use database rate-limit storage, and there is no `rate_limit` table.
- `routeRules` are still only header rules for `/manifest.webmanifest` and `/sw.js`. They do not grant or refuse a screen. Company-settings and platform path checks use `foldedPath`, so `/Settings` and `/Admin/tenants` stay on the same guard as the lowercase routes. Office, member, and authenticated middleware do not branch on the path spelling.
- undici is 8.12.3 only. No 6.x and no 7.x. `unifont` (through `@nuxt/fonts`) had resolved 8.11.2, so `pnpm-workspace.yaml` overrides `undici` to `^8.12.2`. Drop that line once unifont depends on undici >= 8.12.2.
- Vue is 3.5.44 only. `@better-auth/telemetry` and `vue-router` had resolved 3.5.43 beside the app's 3.5.44. The CI artifact materializes symlinks, the server then loaded two Vue copies, and `GET /` returned 500 (`Cannot read properties of null (reading 'ce')` in `renderSlot`). Overrides pin `vue` and the packages that ship with that version (`@vue/compiler-core`, `compiler-dom`, `compiler-sfc`, `compiler-ssr`, `reactivity`, `runtime-core`, `runtime-dom`, `server-renderer`, `shared`) to 3.5.44. The lockfile has one snapshot, `vue@3.5.44(typescript@6.0.3)`. `@vue/devtools-*` and `@vue/language-core` stay on their own lines. Drop the Vue overrides once those dependencies ask for 3.5.44 themselves.
- No route rule sets `cors`, and no handler calls h3's CORS helpers. Nitro's `cors: true` shortcut is unused. A `GET /sw.js` with `Origin: https://evil.example` still has no `access-control-allow-origin`, and `cache-control` stays `no-cache`. The manifest content type is unchanged. There is no `defineCachedEventHandler`. The transfer export still sets `cache-control: no-store`.
- A built server copied with `cp -RL .output` has no symlinks left. The traced `vue` package is 3.5.44, and `GET /` returns 200 (the sign-in page). Node 24.21.0.
- Casing stays covered in `shared/company-settings.test.ts`, `shared/platform-account.test.ts`, and `e2e/signed-out-pages.spec.ts`. `/Settings` and `/SETTINGS/tenant` stay the protected settings route. `/Admin/tenants` stays the firm list. `/Forgot-password` stays public. `/Transfers` still shows the sign-in form.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (868) passed. `pnpm test:e2e` passed (310) on port 30408 because 3000 was already in use. `pnpm audit --audit-level=high` exited 0. `pnpm test:rls` did not run: the local database URL does not name `transferpro_e2e`, and the script exits before vitest. This slice adds no migration and no tenant table.

## Code review

## Standards

No hard documented-standard breaches.

Barrel imports stay on `shared` (`app/middleware/platform-auth.ts`, `app/pages/settings.vue`). `shared/platform-account.ts` imports `foldedPath` from a sibling inside `shared`, which is how that package is built, not a cross-module deep import (`AGENTS.md`: import only from a module’s `index.ts`). New helpers are covered in `shared/company-settings.test.ts` and `shared/platform-account.test.ts`. The signed-out spec is extended, not weakened (`AGENTS.md`: a UI change adds or extends `e2e/`; never weaken a test). No tenant table, migration, personal-data log, or `ignoreGhsas` entry. Override comments say why and when to drop them (`docs/agents/working-rules.md`, Audit ignores). “Firm” in the new platform comments matches the Superadmin rule (“Platform screens list firms”) and the existing comments in `shared/platform-account.ts`.

**Judgement — Duplicated Code.** The same Nuxt 4.6 binding is copied into two pages:

```36:38:app/pages/index.vue
// Nuxt 4.6 typechecks the template against script bindings. The auto-import
// alone is not one, so the class reads this computed.
const office = computed(() => isOfficeMember(session.value?.role))
```

`app/pages/profile.vue` has the same comment and computed. Other shell pages already use that computed (`app/pages/transfers.vue`). A shared composable for only these two would split the shell. Leave it.

**Judgement — Duplicated Code.** `e2e/signed-out-pages.spec.ts` repeats the sign-in assertions for `/Transfers`, `/Settings`, and `/Admin/tenants` instead of folding those paths into `officePaths`. The `/Forgot-password` half is new and should stay separate.

## Spec

**(a) Partial**

- "All CI green, including test:rls and e2e (on transferpro_e2e only)." The handoff records `pnpm test:e2e` (310 passed) and records that `pnpm test:rls` did not run, because `DATABASE_URL` does not name `transferpro_e2e`. This review did not re-run tests. The slice adds no migration and no tenant table.

Everything else in the issue and the owner follow-up is in the diff: Better Auth and the Drizzle adapter `^1.7.12`; Nuxt `^4.6.2` with one `nitropack@2.13.5`; h3 kept at 1.15.11 (one copy); no `socialProviders` / ID-token sign-in and no new `clientId`; no Drizzle migration; `routeRules` still only the manifest and `/sw.js` header rules; `foldedPath` on the settings and platform guards; casing tests for `/Transfers`, `/Settings`, `/Admin/tenants` and public `/Forgot-password`; cache and foreign-origin checks; `undici` override `^8.12.2` resolving to 8.12.3 only; `vue` and the Vue 3.5 `@vue/*` packages overridden to 3.5.44, with a single `vue@3.5.44` snapshot. The handoff lists ID-token sign-in (no), the routeRules review, undici, and the `cp -RL` `GET /` 200 check.

**(b) None**

The `office` computeds on the home and profile pages only keep the existing layout class visible to the Nuxt 4.6 template typecheck.

**(c) None**

Office, member, and authenticated middleware do not branch on path spelling. The settings and platform checks that did are now case-folded, and the new tests cover that.
