# 576 Node 24.22.3, Better Auth 1.7.20, pnpm 12.19.0

Out of scope: Coolify platform updates, Docker Engine on the host, `lockfile.format: v13`, `projectScopedOptionalPeers`, and any other direct dependency.

## Decisions

- Node is `24.22.3` in `devEngines.runtime.version`, `.nvmrc`, every CI `setup-node` pin, and both Dockerfile stages. The image is `node:24.22.3-bookworm-slim` pinned to the registry index digest `sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54`. There was no digest on the previous tag.
- `engines.node` moves the 24 alternative from `^24.11.0` to `^24.22.3`. The 22 and 26 alternatives stay. Those lines shipped the same release, and this app does not run them.
- pnpm is `12.19.0` in `packageManager`, `engines.pnpm` (`>=12.19.0 <13`), and every CI `pnpm/action-setup` pin. `lockfile.format` stays at lockfile 9.0. `projectScopedOptionalPeers` stays unset. 12.19.0 adds an optional `@pnpm/exe.netbsd-x64` package; it is on the age-gate exclude list with the other pnpm executables.
- Better Auth and `@better-auth/drizzle-adapter` are `^1.7.20`. The lockfile resolves both at 1.7.20, and the direct `@better-auth/*` transitives move with that line. No Drizzle migration.
- Age-gate excludes roll from Better Auth 1.7.18 and pnpm 12.18.0 to 1.7.20 and 12.19.0. Nuxt 4.6.4 and Vue 3.5.45 stay excluded. Drop each line once that version installs without an exclude.

## Node 24.22.3 CVEs

The release is https://github.com/nodejs/node/releases/tag/v24.22.3. Nine High items are HTTP/2 and TLS, plus undici 7.30.2 and llhttp 9.4.4 from the private security repo.

What touches this runtime:

- CVE-2026-123864 (High, `tls,http` nested parser on empty writes) and the llhttp 9.4.4 bump are on the HTTP parser. Nitro listens with Node's HTTP server, so a 24.x runtime older than 24.22.3 is not acceptable. That is why the 24 engine floor rises.
- HTTP/2 server CVEs (CVE-2026-123863, CVE-2026-123865, CVE-2026-123866, CVE-2026-123874, CVE-2026-123828, CVE-2026-123868, CVE-2026-123875) do not match the listener. The app does not call `http2.createServer`. The proxy in front of the container speaks HTTP/2 to clients.
- TLS server CVEs (CVE-2026-123872, CVE-2026-126051, CVE-2026-123867) do not match the listener. The process listens on plain HTTP. The proxy terminates TLS. There is no mutual TLS.
- Undici 7.30.2 fixes cache and redirect interceptors (CVE-2026-116592 High, plus five Medium). The app does not import `undici` and does not enable those interceptors. The npm `undici` override stays `^8.12.2`. Node's own `fetch` still ships the bundled 7.30.2 once the runtime is 24.22.3.
- Permission-model CVEs (CVE-2026-123829, CVE-2026-123873) and the zlib CVE (CVE-2026-123862) do not match this process. It does not run with `--permission`.
- CVE-2026-123871 redacts proxy credentials in invalid proxy URL errors. CVE-2026-123877 isolates HTTPS agent TLS policy keys. Neither is a path this app configures. The patched runtime still covers them.

## Better Auth 1.7.19 / 1.7.20 checks

1. **Organization `listMembers`.** The organization plugin is enabled. HTTP `/organization/list-members` stays in `disabledPaths` and the existing member-management test expects 404. The app's `listMembers` reads `app.tenant_member`. The server API still calls the plugin, so `member-management.rls.test.ts` now asks Better Auth `listMembers` for `role` equal to `no-such-role` and expects `{ members: [], total: 0 }`. That is the PostgreSQL empty-filter path fixed in 1.7.19. The local suite URLs do not name `transferpro_e2e`, so this test was not run here. CI `slow` runs it.
2. **OAuth state.** No `socialProviders`. OAuth state is not stored. Not used.
3. **OAuth provider and SAML.** `@better-auth/oauth-provider` is not installed. No SAML or SSO plugin. Not used. The `public-client-prelogin` fix has no runtime effect here.
4. **`/admin/create-user`.** The admin plugin is not enabled. `superadmin:create` inserts the user, the credential, and the grant in one owner transaction and rolls back on failure. `tenant:account` only activates or deactivates a Tenant. Invitation acceptance inserts the user and the credential in one transaction. None of these call `/admin/create-user`.
5. **Private registry.** No. There is no `.npmrc`, no `NPM_TOKEN`, and no registry auth token in CI or the Dockerfile.
6. **Coolify API.** Not used. No script, workflow, or hook calls the Coolify API.
7. **Coolify webhook auto-cancel.** Expected to be fine. A new push deploys the latest commit, and cancelling a queued older deployment matches that. No Coolify setting changes in this PR.

## Verification

- Lockfile written by pnpm 12.19.0. The supply-chain check passed. Direct dependency ranges other than Better Auth are unchanged. Transitive changes are the Better Auth 1.7.20 line, the pnpm 12.19.0 package manager (including `@pnpm/exe.netbsd-x64`), and the Node 24.22.3 runtime pin.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (1132 tests). `pnpm audit --audit-level=high` exited 0. Remaining findings are below high.
- Docker image `transferpro:576-node` built. The build stage ran `pnpm install --frozen-lockfile` (`Lockfile is up to date`) and `pnpm exec nuxi build`. `docker run --rm --entrypoint node transferpro:576-node --version` printed `v24.22.3`.
- `pnpm deploy --prod` into a temporary directory completed on pnpm 12.19.0. The Dockerfile itself does not call `pnpm deploy`.
