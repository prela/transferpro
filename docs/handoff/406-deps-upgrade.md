# 406 dependency upgrade

## Ticket notes

- ID-token sign-in: **no**. `createAuth` has no `socialProviders` and nothing calls social or ID-token sign-in. `auth.account.id_token` is the Better Auth account column, not that sign-in path. No provider `clientId` was added.
- `routeRules` reviewed. The only keys are `/manifest.webmanifest` (`content-type: application/manifest+json`) and `/sw.js` (`cache-control: no-cache`). They set headers. They do not grant or refuse a screen. From Nuxt 4.6.2 those keys also match a different letter case. Neither key is a page.
- Route middleware. The page router already served `/Transfers` and `/Admin/tenants` as the lowercase pages. Company-settings redirects compared the path with case, so `/Settings` was not treated as company settings. The platform middleware returned before the session check unless the path started with the lowercase `/admin/tenants`. Both comparisons now use `foldedPath`. Office, member, and authenticated middleware do not branch on the path spelling.
- undici: **8.12.3** only. No 6.x and no 7.x. `unifont` (through `@nuxt/fonts`) had resolved 8.11.2, under the 8.12.2 floor, so `pnpm-workspace.yaml` overrides `undici` to `^8.12.2`. Drop that line once unifont depends on undici >= 8.12.2.

## Versions

- `better-auth` and `@better-auth/drizzle-adapter` `^1.7.12`
- `nuxt` `^4.6.2` (build reports Nuxt 4.6.2 and Nitro 2.13.5)
- `nitropack` 2.13.5, one copy
- `h3` 1.15.11, one copy

Nuxt 4.6.2 and Nitro 2.13.5 depend on `h3` `^1.15.11`. h3 2.0.x is a separate major. `pnpm update` did not pull it. Forcing 2.0.x would either duplicate majors or leave the server on a line Nitro does not declare. Staying on 1.15.11 keeps one h3 major.

## Schema

Better Auth 1.7.12's organization plugin schema (organization, member, invitation, `session.activeOrganizationId`) matches `db/auth-schema.ts`. Teams and dynamic access control are off, so `teamId` and `organizationRole` are not part of this app. The account model still has the same token and password columns, including `id_token`. The 1.7.11 Postgres `int8` fix applies to Better Auth's own rate-limit table. This app does not use database rate-limit storage, and there is no `rate_limit` table. No Drizzle migration.

## CORS and cache

No route rule sets `cors`, and no handler calls h3's CORS helpers. Nitro's `cors: true` shortcut, which would send `access-control-allow-origin: *`, is unused. h3 2's unanchored CORS origin regex is that helper; this app does not pass an origin pattern. A `GET /sw.js` with `Origin: https://evil.example` still has no `access-control-allow-origin`, and `cache-control` stays `no-cache`. The manifest content type is unchanged. There is no `defineCachedEventHandler`, so Nitro's cache-default change does not apply here. The transfer export still sets `cache-control: no-store` on the response.

## Tests

- `shared/company-settings.test.ts`: `/Settings` and `/SETTINGS/tenant` stay the protected settings route. `/Forgot-password` stays off that route.
- `shared/platform-account.test.ts`: `/Admin/tenants` is still the firm-list path. `/Forgot-password` is not.
- `e2e/signed-out-pages.spec.ts`: `/Transfers`, `/Settings`, and `/Admin/tenants` still show the sign-in form. `/Forgot-password` stays the public reset request. Worker and manifest headers, and a foreign origin, stay as they were.

`pnpm test:rls` did not run here. The local `DATABASE_URL` does not name `transferpro_e2e`, and the script exits before vitest. This slice adds no migration and no tenant table.
