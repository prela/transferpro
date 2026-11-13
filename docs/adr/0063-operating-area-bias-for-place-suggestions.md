# Operating area bias for place suggestions

Status: accepted

The owner accepted this on 13 November 2026, in the grill of #584. It partially supersedes ADR-0031; the sentence is named below. ADR-0018, ADR-0052, and ADR-0061 stand.

## Context

A walk of the preview found place suggestions far from the Tenant. A common hotel name returned only places in other countries. The word "Hotel" alone returned places on several continents. A street with a house number in the Tenant's own city returned a different city first. The request to Google carries the typed text, the session token, and the language, and nothing about where the Tenant works.

ADR-0031 decided "There is no country restriction and no regional bias." The #215 grill gave no legal or technical reason for it. Its user story asked for suggestions from any country, so that Rides outside the Tenant's country can have exact places too, and its out-of-scope list cut a per-Tenant region or bias setting from that work.

These facts were read in Google's documentation on 13 November 2026:

- When a request has neither `locationBias` nor `locationRestriction`, Autocomplete (New) biases by the caller's IP address. Our call runs on the server, so the bias follows the data centre, not the office. This is the likely cause of the finding. It is not yet confirmed.
- `locationBias` prefers an area and still returns places outside it. It is one circle, with a radius of at most 50,000 m, or one rectangle. `locationRestriction` and `includedRegionCodes` exclude everything outside the area or the listed countries.
- `regionCode` is a ccTLD code. It formats the response and biases suggestions. Inside that region a prediction may omit the country, and `secondaryText` may be missing; ADR-0061 already uses the full text then.
- These parameters do not change billing. A session that never ends in Place Details is billed per Autocomplete request.
- Autocomplete returns no coordinates. The Places policies let an app store a place id indefinitely, and cache latitude and longitude for at most 30 consecutive calendar days.

A country is too wide to choose between streets: the same street name exists in almost every town of a country. The owner wants the nearest match first.

The alternatives were a hard restriction to the Tenant's country or area; a restriction with a "search everywhere" action that repeats the lookup without it; a country only; a country derived from the time zone; the Tenant's existing Locations, which have no coordinates; the Admin picking the area through autocomplete, with its coordinates from Place Details stored permanently, or cached for 30 days and refreshed; a JSON list or plain columns on the Tenant settings row; and showing the area to the Admin in v1.

## Decision

### A bias, never a restriction

Suggestions prefer places near the Tenant and exclude nothing. No request carries `locationRestriction` or `includedRegionCodes`. Every place in the world stays reachable, as #215 asked. The owner accepts that a strong match far away sometimes comes first. The office then adds the town to the typed text.

### The operating area

An operating area is a circle a Tenant works in: a point, a radius, and a name. In Croatian it is Područje rada. It is not where a Driver or a Vehicle is, and it has no tie to a dispatcher. An office is one way an area comes about. A Tenant with no office that works in one town has the same area with no address.

In v1 a Tenant has no active area or one.

### Where its coordinates come from

The platform owner sets the area when the Tenant is provisioned, from a public source that is not Google, such as OpenStreetMap or an encyclopaedia. About 1 km is accurate enough. No Place Details call is made, nothing is refreshed, and no job runs. Coordinates a person types from a public source are not Places content. ADR-0031's "We store no coordinates" is about Locations and what Google returns, and it still holds.

### Storage

`app.operating_area` is a tenant table with `id`, `tenant_id`, `name`, `center_lat numeric(8,5)`, `center_lng numeric(9,5)`, `radius_m`, `archived_at`, and `created_at`. It has `FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy with `USING` and `WITH CHECK`, `REVOKE ALL FROM PUBLIC`, and no `DELETE` grant. An area is archived, never deleted.

Checks hold the latitude between −90 and 90, the longitude between −180 and 180, the radius between 1,000 and 50,000 m, and a name that is not blank and no longer than a Location name. A partial unique index on `tenant_id` where `archived_at` is null keeps at most one active area per Tenant, so the database refuses a second one.

`app.tenant_settings` gains a nullable `country_code`, an ISO 3166-1 alpha-2 code. An existing row has none.

### Setting it

`pnpm tenant:operating-area --slug <slug>` sets the area with `--name`, `--lat`, `--lng`, and `--radius-km` (1 to 50, stored in metres). It sets the country with `--country`, and archives the active area with `--archive`. It runs as the owner role and sets `tenant_id` explicitly, as provisioning does for the settings row. Values are checked with Zod against the same bounds as the table.

- With no active area, it inserts one. With one, it updates that row in place. The same values write nothing and exit 0, so running it again never adds a second active row.
- `--archive` sets `archived_at` on the active area. With none, it does nothing and exits 0.
- An unknown slug or a value out of bounds exits 1 with a fixed sentence that does not echo the value.

A change of the area appends `settings.operating_area_set` or `settings.operating_area_archived` with the field names only (`name`, `center`, `radiusM`). A change of the country appends `settings.country_changed` with `{ from, to }`, as the other Tenant settings do (ADR-0015). The actor is `transferpro_owner`, as for the account lever. The audit enum, the shape check, and the copy in both locales come with the same migration.

### The request

The suggestion route reads the active area and the country in the same tenant transaction as the language, and passes them to the Maps port. The port gains an optional area (a centre and a radius in metres) and an optional country. Domain and application code still know no provider (ADR-0031, ADR-0018).

- With an active area, the Google adapter sends `locationBias.circle` with that centre and radius, and `regionCode` when the country is set.
- With a country and no area, it sends `regionCode` only. The server's IP bias may still apply then.
- With neither, the body is as today.

The adapter turns the ISO code into Google's ccTLD (`GB` becomes `uk`), so the domain does not learn Google's vocabulary. The same rule holds for the name field and the address field, because the port does not know which field the text came from (ADR-0061). The fake adapter ignores both values. `MAPS=none` is unchanged.

### Not shown in v1

The app shows the area nowhere in v1. The audit entry is its only trace on screen.

### Later directions

These are named so a later grill starts from them. None is decided.

- The Admin sets the area. It is picked through autocomplete, and the place id is stored. The coordinates come from one Place Details call whose field mask is `location` only, are stored with the time they were fetched, and are refreshed once they are older than 30 days. A failed refresh removes them, and the suggestions fall back to the country. That call needs its own field-mask test, beside ADR-0061's rule for a pick.
- The first step of that is one read-only line in Postavke tvrtke → Operativa with the area's name and radius, or "Nije postavljeno" / "Not set".
- Several areas per Tenant, for a Tenant with offices in several towns. Google takes one circle per request, so one area is active per lookup: a dispatcher's default that the form can change, or one chosen from the Ride, such as the end judged by the area of the start. That decision drops the partial unique index in a small migration.

## Consequences

Streets, hotel names, and generic words should rank places near the Tenant first. Google may still rank a strong far match first, which the owner accepts. Two things are checked by hand on the preview: whether Google honours the circle for streets, and whether the server's IP bias explains the finding, including with a country and no area. Tests never call Google, so no automated test can show either.

The circle and the country reach Google with every lookup. They describe where the Tenant works, not a guest or a Ride. They are not personal data, but the audit entry for the area still keeps only field names.

The adapter test and the adapter comment that pinned a body with no bias change by this decision. That is a changed rule, not a weaker test.

A Tenant without an area or a country behaves as before. Changing the area needs the platform owner until the Admin can set it.

### Superseded

ADR-0031: "There is no country restriction and no regional bias." There is still no country restriction. The request carries a bias from the Tenant's operating area and country, as above.
