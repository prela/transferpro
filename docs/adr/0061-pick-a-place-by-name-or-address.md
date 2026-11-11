# Pick a place by its name or its address

Status: accepted

The owner accepted this on 11 November 2026, in the grill of #544. It partially supersedes ADR-0031; the sentences are named below. ADR-0012, ADR-0014, ADR-0018, and ADR-0052 stand.

## Context

ADR-0031 runs suggestions on the address field only. A pick stores the suggestion's text as the address, plus the provider and the place reference. Typing a hotel's name into the name field suggests nothing. Typing it into the address field finds the place, but stores text such as "Hotel …, street, town" as the address and leaves the name to be typed again. The owner decided that both directions should work: a pick from the name field fills the name and the address, and an establishment picked from the address field also fills an empty name.

These facts were read in Google's documentation on 11 November 2026:

- Autocomplete (New) already returns, for each place prediction, `structuredFormat.mainText` (an establishment's name), `structuredFormat.secondaryText` (the rest, usually the street and the town, and sometimes missing), and `types`. Google warns that the prediction text may differ from the name and the address that Place Details returns for the same place.
- In Place Details (New), `formattedAddress` and `types` are Essentials fields, and `displayName` is a Pro field. A session that ends in a Pro field is billed as Place Details Enterprise + Atmosphere. A session that never ends in Place Details is billed per Autocomplete request, as it is today.
- `establishment` is a Table B type that "may" be returned. Google does not promise it on every establishment. The types that matter for a transfer (`airport`, `international_airport`, `train_station`, `bus_station`, `transit_station`, `ferry_terminal`, `marina`, `lodging`, `hotel`) are Table A types.
- The Places API policies forbid storing Places content other than the place id, and coordinates for 30 days. They name "business names, addresses" as an example. The autocomplete exception covers only a street address that the end user could have typed in full, and "does not apply to any POI". The EEA terms (section 15.1, read in the #226 finding) forbid using Places content other than latitude, longitude, and the place id with any map, including a Google map.

The alternatives were Place Details Essentials on every pick for a canonical `formattedAddress`, Place Details with `displayName`, filling the fields only for a street address, storing only the place id and leaving all text to the office, waiting for a legal reading, prefilling the Location kind from `types`, name suggestions for every kind or behind a button, a separate route or port operation for each field, and keeping the quick add plain text.

## Decision

### Accepted risk

The owner accepts, knowingly, that storing a Google-supplied name and address of an establishment does not comply with a literal reading of the Places API policies. These conditions hold:

- A pick only prefills the fields. The office sees both and may edit them before the save.
- Once saved, the text is the Tenant's own record.
- Nothing else from Google is stored. The place id stays, as ADR-0031 allows. No types, kind, coordinates, or ratings are stored.
- One Location is filled per human pick. Nothing is fetched ahead, in bulk, or in the background.

The same risk has a second point. The Location panel and the Ride detail show that text beside the Embed map of ADR-0052, and the frame's title carries the Location's name. Under the EEA terms (section 15.1), Places content other than coordinates and the place id must not be used with any map. The app does not record whether a text came from Google, so it cannot treat that text differently.

Both points go to the legal review of the privacy and terms documents before the pilot (#223, #206 step 35). If that review rejects them, the fallback is ADR-0031 as it was: suggestions on the address only, with no name filled. It needs no migration.

### Where the text comes from

A pick calls nothing more. The name and the address come from the autocomplete prediction, never from Place Details. The only Place Details call stays the IDs Only refresh of ADR-0052. A later decision may add Place Details to a pick. It may then ask only for Essentials fields, such as `formattedAddress` and `types`, and must carry the session token of the suggestions. A test pins its field mask, so it never reaches `displayName`, any Pro or Enterprise field, or `location`.

A prediction is an establishment when its types contain at least one of `establishment`, `point_of_interest`, `airport`, `international_airport`, `train_station`, `bus_station`, `transit_station`, `ferry_terminal`, `marina`, `lodging`, or `hotel`. Every other prediction is an address, including one with no types. The list is Google's vocabulary, so it lives in the adapter and not in the domain.

For an establishment, the name is `mainText`. The address is `secondaryText`, or the prediction's full text when `secondaryText` is missing. For an address, the name is `mainText` and the address is the prediction's full text, as today. A suggestion whose name or address is empty, or longer than its field allows, is dropped.

### The port

The suggestion operation suggests places for typed text, for either field, through the same route. Each suggestion carries:

- a label, the prediction's full text, shown in the list;
- a name and an address, chosen by the rules above;
- whether it is an establishment;
- the provider and the place reference.

The adapter applies the rules, and the form only chooses which fields to fill. Google does not know which field the text was typed in, so the port does not either. The fake adapter answers with one establishment and one street address, so tests and E2E cover both directions.

### Filling the fields

1. A pick from the name field fills the name and the address, and sets the provider and the reference. An address that was already there, typed or picked, is replaced, because a reference and its address describe one place.
2. An establishment picked from the address field fills the name only when the name is empty. A name already typed is kept, with no prompt. This holds for every kind, and before a kind is chosen, because nothing is sent to Google in this direction.
3. A street address picked from the address field never touches the name.
4. Editing the name by hand keeps the provider and the reference. Only a hand edit or a clear of the address removes them (ADR-0031).

The office always chooses the Location's kind, and a pick never sets it. The kind drives rules that the text does not: an airport's IATA code and its uniqueness in the Tenant, and the exclusion of address-kind Locations from the circuit breaker of ADR-0052. A wrong kind would change those rules silently, while a wrong name is in plain sight.

### When the name field asks Google

The name field suggests places only when the chosen kind is airport, hotel, or other. With no kind yet, or with the kind address, it is a plain field, because the name of a private place is often the guest's. The kind field moves above the name field in the Location panel and in the quick add of the Transfer form. The address field suggests for every kind, as today.

The name field asks Google only after a keystroke in that field. Opening the panel, opening the quick add with its prefilled name, and choosing a kind send nothing. Changing the kind to address closes the name field's list and drops a lookup in flight. A change of kind never clears the name, the address, or the reference. On an existing Location, a pick from the name field follows rule 1, and Enter without a pick keeps the typed text. An archived Location is read-only.

### Sessions, the notice, and attribution

Each field has its own session token. It is created on the first lookup in that field, dropped on a pick, and never shared with the other field. With no Place Details, a session is billed per request, as today.

The form has one notice, under the field whose lookup failed, and it goes once a lookup succeeds. It reads "Prijedlozi mjesta nisu dostupni. Naziv i adresu i dalje možete upisati." / "Place suggestions are unavailable. You can still type the name and the address." With `MAPS=none`, both fields are plain and saving works.

Both lists credit "Google Maps", untranslated, where they credited "Google".

### The quick add

The quick add of a Location in the Transfer form works the same way, in both directions. Both forms share one piece of suggestion logic, so these rules exist once.

### Privacy

The name text is treated like the address text. It is never logged, never sent to the error tracker, and never stored as an audit value. The audit entry keeps the field names `name`, `address`, and `placeRef`. The suggestion's label joins the redaction list. The privacy documents (#206 step 35) say that the text typed in the name field of an airport, hotel, or other Location is sent to Google for suggestions, as the address text already is.

### Superseded

ADR-0031: "suggest addresses for typed text". The operation suggests places for text typed in the name field or the address field.

ADR-0031: "A pick stores the suggested text as the address". A pick stores the address chosen by the rules above, and may fill the name.

ADR-0031: "The Location added inline from the Transfer slideover keeps a plain text address." #281 already gave the quick add address suggestions. It now gets both directions.

ADR-0031: "The office's typed address text reaches Google". So does the name text of an airport, hotel, or other Location.

## Consequences

Entering a hotel, an airport, a station, a port, or a marina takes one pick instead of a pick plus a typed name. An establishment's address is Google's secondary text, not a canonical postal address. It may lack a postal code, or name only the town. The office can complete it before the save, and the directions link and the map follow the place reference, not the text.

With `MAPS=none` or a suspended key, the saved text is the only readable address the Driver gets. Navigation still follows the stored place reference, which needs no key. Place Details Essentials with `formattedAddress` stays a documented later option, and it needs no migration.

A wrong classification degrades gently. A hotel taken for an address behaves as today, and a street taken for an establishment fills only an empty name, which the office sees.

The kind now comes before the name in both forms, and a dispatcher who wants name suggestions chooses the kind first.

Under the accepted risk, Google could object to the stored text, or to that text beside its map. The expected worst outcome is a suspended key, and the app then runs as with `MAPS=none`.

This work is not on the #206 route. It can be cut as a whole, as a new item just before step 23 on the cut list. Without it, the ADR-0031 suggestions, the map, and the refresh still work.
