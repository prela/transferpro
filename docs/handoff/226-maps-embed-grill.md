# 226 Maps Embed grill

Out of scope: code, migrations, coordinates, distance, routing, a map with several pins, a Maps JavaScript or static map, a map on the Driver's phone, and how a Location gets its price-list zone (#206 step 24).

## Decisions

- #206 step 22 is a grill, Q1–Q20, from the #226 finding. It produced ADR-0052 and two sentences on **Location** in `GLOSSARY.md`. The step 23 spec and tickets are issues, not files, and are filed from a publish kit outside the repo.
- ADR-0031 is not edited apart from its status line. The Embed key in the browser contradicts "The key never reaches the browser", so ADR-0052 partially supersedes ADR-0031 and names each sentence. It also replaces "listed as a sub-processor" with an independent controller, as the owner's comment on #223 already says.
- **Where the map appears.** The office Location panel and the office Ride detail (start and end), closed until "Prikaži na karti":
  - none on the Driver's card, on the board rows, or for an archived Location;
  - on the Ride detail, independent toggles, one button when the start and the end are the same Location, and on a phone one open map at a time;
  - in the Location panel, any change to the address field closes the map until the save;
  - an open map reloads only when its Embed URL changes, and closes when it becomes empty.
- **The key.** `MAPS_EMBED_KEY` is a second key per environment, restricted to the Maps Embed API and the environment's origin, and optional. The Embed URL is built on the server when a Location is read, in office responses only. A separate route that hands out the URL after the click was rejected: the Embed is free and unlimited, and the key is public once a map renders.
- **What the map shows.** Only `q=place_id:` with a `google` reference, never the address text or the name. The map's language is the viewer's locale.
- **The frame.** Google's attribution stays as drawn. No `sandbox`, an empty `allow`, `strict-origin-when-cross-origin`, and never `no-referrer`. Google's own error inside the frame is accepted. The button has `aria-expanded` and `aria-controls` and keeps the focus.
- **The refresh:**
  - **Storage:** one nullable timestamp, the last check of the reference.
  - **Job:** nightly, only with `MAPS=google`, Tenant by Tenant in the Tenant session, active Locations only, at most 100 checks per Tenant per night. Each request has the field mask `id` only.
  - **Outcomes:** the same id sets the timestamp; a new id replaces the reference; only `NOT_FOUND` clears the place and keeps the address. `INVALID_REQUEST`, an error, a timeout, or a spent quota changes nothing and is logged as a count. An invalid answer more likely means our request is wrong.
  - **Circuit breaker:** it counts only Locations that are not address-kind. When more than half of them, and at least 10, are gone, the run writes no clear that night, for any kind, and logs one warning.
  - **Race:** the write is a compare-and-set against the reference that was checked, so an office pick in between wins.
  - **Record:** no audit entry, logs with counts only, no office notice.
- **`MAPS` modes.** With `MAPS=none`: no button, no refresh, and the references are kept. With `MAPS=google` and no Embed key: no button, and suggestions and the refresh run.
- **The demo seed** stores no place ids today. It gains real Google place ids for public places only (the airport, a hotel), never for an address-kind Location. E2E keeps its fake ids and always runs on the fake adapter.
- **The price list.** Step 22 gives step 24 no geometry. Zones and coordinates belong to the step 24 grill.
