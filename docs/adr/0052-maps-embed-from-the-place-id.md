# Maps Embed from the stored place id

Status: accepted

Damir accepted this on 22 October 2026, in the step 22 grill of #206. It is the later decision on a map view that ADR-0031 asks for, and it partially supersedes ADR-0031; the sentences are named below. ADR-0012, ADR-0014, and ADR-0018 stand. The finding behind it is the comment "Findings" on #226 (research: storing Google Maps POI data).

## Context

ADR-0031 stores a Location's address text, plus a provider and an opaque place reference when the office picks a suggestion. It stores no coordinates and calls no Place Details. The Driver gets a directions link, and there is no map in the app. ADR-0031 leaves a map view to a later decision.

The #226 finding answers what a map may use. A place id may be stored without a time limit. Google recommends refreshing one that is older than 12 months, and that refresh is free. Coordinates from Places may be kept for 30 days only, so storing them would bring a deletion duty. The Maps Embed API takes `q=place_id:…` in place mode, so it shows a pin from the stored id with no coordinates and no Place Details call. It is an iframe whose key is in the URL, so the browser sees the key. Google draws its own attribution inside it. Opening it sends the viewer's IP address and the place id to Google.

Google's [Maps Embed API Usage and Billing](https://developers.google.com/maps/documentation/embed/usage-and-billing) page says "Maps Embed usage is available at no charge" and that there are "no short-term (queries per second) or long-term (queries per day) limits". Google's [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id) page says place ids may be stored, recommends refreshing them after 12 months, and says a Place Details request that asks only for the id is free and is billed as the Place Details Essentials IDs Only SKU. It says `NOT_FOUND` means the id is obsolete and `INVALID_REQUEST` means it is no longer valid. It also says the id of a street address inferred from a range of addresses, or of an address with a subpremise, may answer `NOT_FOUND` or a different id. A guest's private address is often such an id. Both pages were read on 22 October 2026.

The alternatives were a Maps JavaScript map or a static map image (both billed per load), stored coordinates on any map, an Embed by address text or by name, handing the Embed URL out only through a separate route after the click, a preview of an unsaved pick built in the browser, a map on the Driver's phone, a map for an archived Location, refreshing on read, auditing the refresh under a system actor, clearing a reference only after two answers on separate nights, hiding the map while keeping a reference Google no longer finds, and no refresh at all.

## Decision

### Where the map appears

The office sees a map in two places: the Location panel, and the Ride detail, once for the start and once for the end. The map is closed until someone presses "Prikaži na karti". Until then nothing is sent to Google, because the iframe exists only after the press. The same button then reads "Sakrij kartu" and removes it. The Driver's phone gets no map and keeps its two directions links. The board rows stay text. An archived Location has no map button, because the refresh does not keep its reference fresh; its text and its directions link stay.

On the Ride detail, the start and the end have their own buttons and may be open together. When the start and the end are the same Location, only the start has a button. On a phone, opening one map closes the other.

In the Location panel, any change to the address field closes the map and hides the button until the save. A pick that is not saved yet is never shown; after the save, the button comes back from the value the server built.

An open map does not reload while its Embed URL stays the same, so a live refresh (ADR-0039) sends nothing to Google. When the URL changes, because the refresh replaced the id or the office picked again, the map reloads once. When it becomes empty, the map closes and the button goes. Moving to another Ride closes it.

The button carries `aria-expanded` and `aria-controls`, and keeps the focus when the map opens, so a keyboard user is not dropped into Google's frame. The frame's title is "Karta: " and the Location's name, in the viewer's locale. The frame around the map follows the theme tokens; the map itself keeps Google's look in both themes.

### What the map shows

The map is a Maps Embed in place mode with `q=place_id:` and the stored reference, and only when the stored provider is `google`. A Location without a reference, or with another provider's reference, has no button. The map is never built from the address text or the name, so nothing typed by hand reaches Google through a map. The map's language is the viewer's own locale. Nothing about the map is stored.

The maps port gains an operation that builds the Embed URL for a Location, or answers that there is none. Domain and application code know the port only.

### The Embed key

The Embed uses its own key, `MAPS_EMBED_KEY`, never the server key of ADR-0031. Each environment has its own. In Google Cloud it is restricted to the Maps Embed API, and by HTTP referrer to that environment's origin. Once a map is shown, that key is public by design. The server builds the Embed URL when a Location is read, the same way it builds the directions link, and only responses for an Admin or a Dispatcher carry it. A Driver's response never does. The key and the Embed URL are never logged; both join the redaction list beside `MAPS_API_KEY`.

`MAPS_EMBED_KEY` is optional. With `MAPS=none`, or when the key is missing, there is no button, and the app still boots.

### Attribution and the iframe

The Embed draws Google's own attribution. We add no second credit, and we never cover, crop, or restyle the map. The iframe is the panel's width and 240px high, above Google's minimum of 200px in each dimension. It uses `referrerpolicy="strict-origin-when-cross-origin"`, and no page may set a `no-referrer` policy, because that would break the key's referrer restriction. It has a localized title for screen readers. It has no `sandbox` attribute, because Google's scripts and its "View larger map" link must run, and its `allow` grants nothing, so the map cannot ask for the location, the camera, or the microphone. Google may show ads inside it, and we accept that.

The frame is on Google's origin, so the app cannot tell when the map fails: a key restricted wrongly, an id that went obsolete between two checks, or no network. Google's own message inside the frame is accepted, with no detection and no fallback. The key's restrictions are checked on every environment before the pilot (#223).

### Refreshing the place id

A Location gains one nullable timestamp: when its place reference was last checked. A pick sets it in the same write as the reference. A hand edit or a clear empties it with the provider and the reference. Existing rows are not rewritten. A reference with no timestamp is due.

A nightly job, only when `MAPS=google`, walks the Tenants and works inside each Tenant's session. It checks the active Locations whose provider is `google` and whose reference is unchecked or was last checked more than 12 months ago, at most 100 per Tenant per night. Each check is a Place Details request with the field mask `id` and nothing else, on the server key. The outcomes:

- the same id comes back: the timestamp is set;
- a different id comes back: the reference is replaced and the timestamp is set;
- `NOT_FOUND`: the provider, the reference, and the timestamp are cleared, and the address stays. The map button goes, and the directions link falls back to the address;
- `INVALID_REQUEST`, a timeout, an error, or a spent quota: nothing changes, and the next night tries again. An invalid answer more likely means our request is wrong than that the place is gone, so it never clears a reference; it is logged as a count.

A wave of `NOT_FOUND` answers more likely means Google or our adapter is broken than that the places are gone, so a circuit breaker guards the clears. It counts only the Tenant's Locations in that run that are not address-kind (airport, hotel, other), because a guest's address may answer `NOT_FOUND` while the place is fine. When more than half of those, and at least 10, come back as gone, the run writes no clear that night, for any kind. It still writes the same and replaced answers, and logs one warning with the counts. The held-back Locations stay due and are checked again the next night.

The job writes only when the reference is still the one it checked, so an office pick made in the meantime wins. The refresh writes no audit entry; like the live status writing a landing time (ADR-0028), it is not a member's action. Its log lines carry counts, never an id, a reference, or an address. The office is not told.

### `MAPS` modes

With `MAPS=none` there is no map button, stored references are kept, the directions link still uses them, and the refresh does not run. When `google` returns, the references that aged meanwhile are due. With `MAPS=google` and no `MAPS_EMBED_KEY`, suggestions and the refresh run, and there is no map button.

### Cost

The Embed and the IDs Only refresh are both free and unlimited, so the app adds no rate limit of its own, as ADR-0031 already decides. The guards are the two key restrictions (the Embed key to the Maps Embed API and the origin, the server key to the Places API (New)), a test that pins the refresh request's field mask to `id` so it cannot drift into a billed tier, the cap of 100 checks per Tenant per night, and the per-environment budget alerts of #223.

### Privacy

Google Maps Platform is an independent controller for this data (Google Ireland Limited for European personal data), not a sub-processor (#226). Opening a map sends the viewer's IP address and the place id to Google at display time. The privacy documents say so before the pilot (#223, #206 step 35). An in-app map is a material modification under Google's EEA terms, so a project owner accepts those terms before the first key goes live. That is owner work outside the code.

### Superseded

ADR-0031: "We will put maps behind one port with two operations". The port also builds the Embed URL and checks a stored reference.

ADR-0031: "The key never reaches the browser." The server key of ADR-0031 never reaches the browser. The Embed key, a second key restricted to the Maps Embed API and the environment's origin, does.

ADR-0031: "We do not call Place Details. The adapter may add that later without a migration." The refresh calls Place Details for the id only, and adds the nullable timestamp of the last check in a migration. No other Place Details call is made.

ADR-0031: "A change to the reference is audited by the field name `placeRef` only." An office change is. A change made by the refresh is not audited.

ADR-0031: "Google is listed as a sub-processor in the privacy documents before the pilot." Google Maps Platform is listed as an independent controller.

ADR-0031: "Coordinates, distance, routing, and a map view need a later decision." This record is that decision for a map view. Coordinates, distance, and routing still need one.

## Consequences

A Location picked from a suggestion shows on a Google map at no cost, and nothing typed by hand reaches Google through it. A Location typed by hand, saved under `MAPS=none`, or edited after a pick has no map until the office picks a suggestion again. There are still no coordinates, so there is no distance, no route, and no map with several pins.

A refresh can replace or clear a reference with no member acting and no audit entry. A cleared reference drops the map and turns the directions link into an address link, and the office learns of it only by looking. For a guest's street address, that link is good enough. Without the refresh job, older references can stop resolving. That is risk 10 on #206. A Tenant whose hotels and airports keep tripping the circuit breaker gets a warning every night, and the logs are where ops sees it.

The map gives the price list (#206 step 24) nothing geometric: no coordinates, no distance, and no zone from a point. How a Location gets its zone, and whether that uses coordinates, is a question for the step 24 grill and its own record.

The Embed key is visible to anyone who opens a map. Its two restrictions are what keep it from being used elsewhere, so a key created without them is a fault the owner checks before the pilot. Ads that Google shows inside the map are outside our control.
