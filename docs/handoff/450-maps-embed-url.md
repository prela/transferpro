# 450 Embed URL on office reads

Out of scope: the map panel is #451, and the refresh job and `place_ref_checked_at` stay later steps.

## Decisions

- `embedUrl` is built on the office read and is not stored. No migration.
- The language is the member's chosen locale, otherwise the Tenant default. Address suggestions still use the Tenant default only.
- Tests use the fake adapter even when `MAPS=google`, so a route proof is an `about:blank` fragment. The Google host, path, query, and key are unit-tested.
- `name` and `address` stay on the embed target so a test can show they are absent from the URL. A bad embed key throws a fixed sentence. The two RLS files set `MAPS` and the keys themselves.
- `embeddable` checks `provider === 'google'` in the port. ADR-0052 requires a Google-only URL, and no application file calls that helper.
- Demo names stay fictional. The airport place id is `ChIJ6YIGjkMSTBMR2VHFkRMhOCU` and the hotel place id is `ChIJ_62IVDULTBMRi7eaGcc6tGQ`. The address-kind Location stays without a place. E2E keeps `ChIJfakeDubrovnik`.
- The client list schema still strips `embedUrl` until #451.
- The docs branch was already squash-merged (#455, `687bee4`). This branch is only the feature commit, cherry-picked from `5e45aad` onto `origin/develop` as `42ab59f`.
- The reports below are verbatim from the review of that commit.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (942) passed. `pnpm test:e2e` passed (331, 5.1m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored). During implement, `pnpm test:rls` passed (432) on `transferpro_e2e`.

## Code review

## Standards

No hard documented-standard breach. Role checks stay on the office loaders, the Embed key and `embedUrl` are redacted, routes parse with Zod, and cross-module imports stay on each module's `index.ts` (`AGENTS.md` Security; `docs/agents/working-rules.md` Logging; ADR-0018; ADR-0052).

**Judgement — Speculative Generality, `server/modules/locations/maps-port.ts`.** `name` and `address` are never read when the URL is built. The comment says they exist so a test can show the URL was not built from them:

```28:37:server/modules/locations/maps-port.ts
 * The name and the address are on the target so a test can show the URL
 * was not built from them. An archived Location has no map.
 */
export interface EmbedTarget {
  readonly name: string
  readonly address: string | null
```

**Judgement — same smell, `server/core/index.ts`.** After `blankEnv`, the value is either missing or a non-empty string, so `z.string().min(1)` cannot fail:

```216:223:server/core/index.ts
function parseMapsEmbedKey(source: NodeJS.ProcessEnv): string | undefined {
  const key = blankEnv(source.MAPS_EMBED_KEY)
  if (key === undefined)
    return undefined
  const parsed = z.string().min(1).safeParse(key)
  if (!parsed.success)
    throw new Error('MAPS_EMBED_KEY is invalid.')
```

**Judgement — Duplicated Code.** The same `MAPS` / `MAPS_API_KEY` / `MAPS_EMBED_KEY` bootstrap is copied in `server/api/locations.rls.test.ts` and `server/api/rides/upcoming.rls.test.ts`:

```
process.env.MAPS = 'google'
if (process.env.MAPS_API_KEY === undefined || process.env.MAPS_API_KEY === '')
  process.env.MAPS_API_KEY = 'test-places-key'
process.env.MAPS_EMBED_KEY = 'test-embed-key'
```

**Judgement — ADR-0031 adapter boundary.** `embeddable` in `maps-port.ts` branches on `place.provider === 'google'`. ADR-0031 keeps Google in the adapter ("Domain and application code know the port only"), and `navigation-link.ts` already keeps `LINK_PROVIDER` in infrastructure. ADR-0052 does require a Google-only URL, and no application file calls `embeddable`, so this is not a hard breach.

## Spec

No findings. The working tree matches issue #450, and the parts of ADR-0052 and ADR-0031 that the issue cites.

**(a) Missing or partial.** None. The port operation returns a URL only for an active Location with a stored `google` reference while the Embed is configured, and it does not use the address, the name, or the network. The Google adapter builds a place-mode URL with the Embed key, `q=place_id:<reference>`, and `language`. The fake adapter returns `about:blank` with the reference and the language in the fragment. `POST /api/locations/embed-mode` is 404 unless `NODE_ENV=test`. `MAPS_EMBED_KEY` is optional for both `MAPS` values, a blank value is missing, and boot errors do not include the value. `.env.example` and `docs/ops/preview.md` list the key, restricted to the Maps Embed API and the environment origin. The shared redaction list drops `MAPS_EMBED_KEY` and `embedUrl`. Office list, create, update, and archive responses carry `embedUrl` (`string | null`) for Admin and Dispatcher, using the member locale or the Tenant default. The Driver upcoming payload is unchanged and the route test shows it has neither the URL nor the key. The demo seed sets public place ids on the airport and the hotel only. The address-kind Location stays null, and the E2E fake id is untouched. Unit tests cover the URL, the env cases, and redaction. The locations RLS test covers an active google reference, a typed Location, an archived Location, and the Embed switch.

**(b) Scope creep.** None. Create, update, and archive return the same office field the route tests require. The test switch follows the existing suggestions-mode route. The map panel, the refresh job, and `place_ref_checked_at` are absent.

**(c) Implemented but wrong.** None.
