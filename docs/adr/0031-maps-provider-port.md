# Maps for Locations behind a port

Status: accepted

Damir accepted this on 13 October 2026. This does not supersede ADR-0012, ADR-0014, ADR-0018, or ADR-0026.

## Context

A Location has a name, a kind, an optional free-text address, and, on an airport, an optional IATA code. The office types the address by hand, and the Driver's phone shows it as text. The owner decided on 9 October 2026 that v1 gets address suggestions in the Location form and a one-tap navigation link for the Driver. The Charter asks for provider-neutral code with configuration through env. GPS stays a v1 non-goal, and this decision does not track a Driver. An address-kind Location is often a guest's private address, so the typed text is personal data. ADR-0012 already keeps addresses out of logs, and ADR-0014 keeps them out of audit entries.

The alternatives were an EU-hosted or self-hosted geocoder (Photon or Nominatim on Coolify, or a commercial EU provider), Google's browser widget with a key restricted to our domain, stored coordinates, a Place Details call after every pick, a country restriction or a regional bias, and a backfill of existing Locations.

## Decision

We will put maps behind one port with two operations: suggest addresses for typed text, and build a navigation link to a Location. Domain and application code know the port only. Google Places is the first suggestion adapter. A fake adapter serves tests and E2E. The `MAPS` env value selects `google` or `none`, and the default is `none`. `google` also requires a key in env, never in the repo, with a separate key and a Google Cloud quota per environment so the cost stays at the free tier. Tests and E2E never call Google.

The call runs on the server. A Nitro route for an admin or a dispatcher takes the typed text in a POST body, validates it with Zod, and calls the adapter with a session token and the Tenant's default locale as the language. There is no country restriction and no regional bias. The key never reaches the browser. The suggestion list shows Google's attribution whenever Google supplied it.

A pick stores the suggested text as the address, plus two nullable columns: the provider and an opaque reference to the place. Both are set or both are empty. A reference requires an address. A hand edit or a clear of the address removes the provider and the reference in the same write. A new pick replaces both. We do not call Place Details. The adapter may add that later without a migration. We store no coordinates, and the stored link is not a column: it is built when it is read.

The navigation link opens directions to the place. It uses the reference when its provider matches the link adapter, otherwise the address, otherwise the Location's name. It needs no key and calls nothing from our server, so it exists in every `MAPS` mode. In v1 it is a Google Maps URL. The Driver gets one link for the start and one for the end of each upcoming Ride.

When suggestions are unavailable (`MAPS=none`, a missing key, an error, a timeout, or a spent quota), the address field stays plain text with one quiet notice, and saving still works. The app adds no rate limit of its own. The Google Cloud quota is the hard cap.

The typed text and the reference are treated as an address. They are never logged, never sent to the error tracker, and never stored in an audit entry. A change to the reference is audited by the field name `placeRef` only. Fetching suggestions is not a state change and is not audited. Existing Locations get no backfill. They gain a reference when the office corrects them and picks a suggestion.

## Consequences

The office's typed address text reaches Google in the US under the EU–US Data Privacy Framework. Google is listed as a sub-processor in the privacy documents before the pilot. That is owner work outside the code.

Swapping the provider means writing a new adapter. Stored references from another provider are ignored, and links fall back to the address text. A hand edit after a pick loses the exact place, so the office picks again when it wants a precise link. A Location with neither a reference nor an address links by name, and that can open the wrong place for an ambiguous name.

Coordinates, distance, routing, and a map view need a later decision. Under Google's terms as we understand them, coordinates from Places may only be cached for a limited time, while a place reference may be kept. The Charter is not edited here, which follows the precedent of ADR-0028. The work-order email still has no link (ADR-0026). The Location added inline from the Transfer slideover keeps a plain text address.
