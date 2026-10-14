# 215 Location maps

Out of scope: coordinates, a map view, suggestions in the Transfer slideover, a work-order email link, Place Details, an application rate limit, a backfill, and an office "Open in maps" link.

## Decisions

- `MAPS` defaults to `none` in every environment. `google` requires `MAPS_API_KEY`. Tests and E2E always use the fake adapter, including when `MAPS=google`.
- `POST /api/locations/suggestions-mode` exists only when `NODE_ENV` is `test`. It tells the fake to answer unavailable. Any other environment is 404.
- The audit field is `placeRef`. An entry does not store the address, the provider, or the reference. Suggestion lookups are not audited.
- The navigation link is a Google Maps directions URL in every `MAPS` mode. The destination text is the address, otherwise the name. `destination_place_id` is added only when the stored provider is `google`.
- The Driver list calls `mapsForApp(loadAppEnv()).navigationLink`. The locations index does not export the concrete function.
- Suggestion language is the Tenant default locale. The pause before a lookup is 300ms. A pick clears the session token so the next search creates a new one.
- A place reference is at most 1024 characters. A keystroke that changes the address drops the held place. Enter submits the typed address and does not store the highlighted suggestion.
- A lookup already in flight is ignored when the field becomes shorter than 3 characters, the form resets, or another Location is opened.
- The Transfer record is unchanged. The inline add on the Transfer slideover stays plain text and sends no place.

## Code review

## Standards

**Hard**

`app/components/LocationList.vue` — address suggestions are a hand-built `ul`/`button` listbox, not a Nuxt UI control and not a Reka primitive. `docs/agents/working-rules.md` (i18n and theme) and `docs/adr/0016-nuxt-ui.md`: Nuxt UI is the only UI library; if it lacks a component, build from the Reka primitives it already uses. That rule points at the Nuxt UI skill, which names `UInputMenu` for type-and-pick. The option buttons are `py-2 text-base`, not size `xl` (ADR-0016: tapped controls use size `xl`).

```html
<ul v-if="suggestions.length > 0" role="listbox">
  <button type="button" role="option" class="… py-2 … text-base" />
</ul>
```

`server/modules/transfers/infrastructure/driver-ride-access.ts` and `server/modules/locations/index.ts` — the Driver list calls the concrete `navigationLink`, and the module index re-exports it. `docs/adr/0031-maps-provider-port.md`: one port, two operations; domain and application code know the port only. A later adapter’s `navigationLink` would not affect this caller. Consequences in that ADR: swapping the provider means a new adapter, and a foreign reference falls back to the address.

```ts
import { loadLocation, navigationLink } from '../../locations'
fromMapsUrl: navigationLink(from),
toMapsUrl: navigationLink(to),
```

**Judgement**

Duplicated Code — `app/components/DriverRides.vue`. Start and end are the same `UButton` twice (`ride.fromMapsUrl` / `ride.toMapsUrl`, same `target`, `variant`, `size`, and `t('driverRides.openInMaps')`).

Duplicated Code — `AddressSuggestion` twice. `server/modules/locations/maps-port.ts` has `provider: string`. `shared/location.ts` uses `placeProviderSchema` (`'google'` only). The same three fields can drift.

Not in breach: journal `when` is the previous entry plus 1000; both locales; audit stores `placeRef` by name only; `text` and `placeRef` are redacted; the suggestion body is Zod-parsed before the session and `officeOnly` refuses a driver; Tenant B cannot read or write the new columns. The Google URL in every `MAPS` mode is what ADR-0031 requires, so it does not contradict the Charter.

## Spec

### (a) Missing or partial

The user stories and the implementation decisions are present in the diff.

Testing Decisions: "Extend the driver rides spec: each upcoming Ride shows a start link and an end link whose target is a maps directions URL, with the exact place after a pick and the address text otherwise."

The page renders both links on every upcoming card. The extended spec asserts both links only on the card ride (place id on the start, address on the end). The cash ride asserts the start link (the Location name) only. The invoice ride, also upcoming, is unchecked. The English check is that one start link is visible.

### (b) Scope creep

Office UI: "The address field in the Location slideover becomes an input with a suggestion menu. A pick fills the address and holds the place."

`onAddressEnter` is extra. While the menu is open, Enter calls `preventDefault` and `pickSuggestion` on the first row, so that keystroke stores a place instead of submitting the typed address. Story 17: "As a dispatcher, I want to save a typed address without picking any suggestion, so that suggestions help me but are never required."

### (c) Implemented but wrong

Story 3: "As a dispatcher, I want suggestions to start after I have typed at least 3 characters, so that I do not get noise from one letter." Story 15: "As a dispatcher, I want a quiet notice when suggestions are unavailable, so that I understand why the list is empty."

`lookupSuggestions` returns before 3 characters without advancing `suggestGeneration`, so an in-flight response can refill the menu after the field is shorter than that. Closing the slideover, `resetForm`, and `openEdit` do not cancel that generation. `openEdit` also leaves the debounce timer and `suggestionsUnavailable` as they were. The correct form can show another search's rows, or the unavailable notice, before a lookup on that Location. Picking a stale row writes that address and place.

Follow-up on this branch: the address field is `UInputMenu` (`mode="autocomplete"`, size `xl`). Enter closes the menu and submits the typed address; a click still stores the place. `dropPendingSuggestions` advances the generation when the field is too short, the form resets, or another Location opens. The Driver list calls `mapsForApp(loadAppEnv()).navigationLink`, and the locations index no longer exports the concrete function. The driver spec asserts the start and end links on the cash, card, and invoice rides, in Croatian and in English.
