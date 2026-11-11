# Transfer day header: view, filters, and tools

Status: accepted

The owner accepted this on 11 November 2026, in the grill of #564. It partially supersedes ADR-0038: in its Transfers section, the sentence that lists the toolbar ("The toolbar has `◀ Danas ▶` and a date picker, … and Client and Driver filters."). The rest of ADR-0038 stands, including the seven-day note, the occupation strip, and the phone rule. ADR-0039 stands: "Ažurirano u" sits beside Osvježi, the automatic refresh switch sits beside the time, and no page shows a strip of alarms across its top. The filter logic of #546 (AND, the URL keys, the empty state) is unchanged.

## Context

After #546 the Transfers header held, side by side: the day and a new-Transfer button; the search and the Client, Driver, Vehicle, and Partner filters; the Ride-state filter and "Treba pažnju"; eight quick-filter chips; refresh, print, export, and automatic refresh; the occupation strip; and "Proširi sve". Views, filters, and tools looked alike and competed for attention. On a 360 px phone the header was about 1,000 px tall, so the first Ride was below the first screen. Active filters were visible only inside their own fields, a filter clear existed only in the empty state, a view opened from Home had no pressed chip, and a filter id that no longer matched a record showed as "all" while it still narrowed the list.

Three layouts were compared: (A) three bands, with the filter fields in a disclosure on the desktop and a bottom sheet on the phone; (B) one compact bar with the filters in a popover on the desktop and a sheet on the phone, and the tools in a menu; (C) every group as an accordion section. B covers the list while the office filters on the desktop and nests a select inside a popover. C lets the views collapse, which ADR-0039 does not allow for the urgent count, and hides the automatic refresh switch, which would amend ADR-0039.

## Decision

We use layout A. The header has, in this order and in this focus order: a "Preskoči na vožnje" link that is visible on focus and moves focus to the Ride list; the day band; the view band; the filter band; and the tools band. The occupation strip follows as its own section, and "Proširi sve" stays with the list. The same DOM serves the desktop and the phone, with no CSS reordering. The phone layout applies below 1024 px, the same breakpoint as the Ride list.

- **Day band**: `◀ Danas ▶`, the date, and the seven-day note. It is navigation, not a filter. The new-Transfer button leaves this band; `+ Novi transfer` in the top bar and the floating button on the phone remain.
- **View band** ("Pogled", en "View"): the seven chips of ADR-0038 and "Za fakturiranje". One view is chosen. The pressed chip is filled and carries `aria-pressed`. A view opened from Home that has no chip shows as one more pressed chip at the end of the row, with its existing label. On the desktop the row wraps; on the phone it scrolls sideways in one row and the active or focused chip scrolls into view.
- **Filter band**: the search, always visible, and behind a "Filtri (n)" button the Client, Driver, Vehicle, Partner, Ride-state, and "Treba pažnju" fields. The count leaves out the search. On the desktop the fields are a disclosure that is open by default; the choice is kept per user and Tenant in `localStorage`, read after mount, like the occupation strip. Filters in the address do not open it. On the phone the fields are in a modal bottom sheet that starts closed. Every change filters at once and goes to the address; there is no Apply. On the phone the row with the search and the button sticks under the top bar.
- **Active filter summary**: below the fields, one tag per active filter, "Label: value", each with its own remove button, and "Očisti filtre". This clear removes the filters and keeps the view. The empty-state "Očisti filtre" still clears everything, because a view can empty the list too. An id that matches no record shows as "Nepoznat …" and can be removed.
- **Tools band**: Osvježi, "Ažurirano u", and the automatic refresh switch together, then Ispiši dan and Izvoz CSV. On the phone the last two are in a menu labelled "Alati". Ispiši dan still prints the whole loaded day.

"Hitno (n)" keeps counting every Ride of the day, so a filter cannot hide an urgent item. When the filters hide at least one urgent Ride, one line of text under the view band says how many and offers "Očisti filtre". It is not a coloured strip and not a live region. The view does not count for this line.

When a view or a filter narrows the list, the list band shows "Prikazano: {shown} od {total}". A separate polite live region announces it only after the user's own change, never after an automatic refresh. Until the first load of a day ends, the chips show no counts and the list is `aria-busy`.

## Consequences

The office reads the day in the order it works: which day, which view, which filters, then the tools. The urgent count cannot be hidden by a filter, and the line under the views explains a count that is larger than the rows shown.

Two buttons named "Očisti filtre" clear different scopes: the summary's keeps the view, the empty state's does not. A user who collapsed the desktop filters sees them open for a moment after each load, because the choice is read from `localStorage` after mount. A cookie would avoid that, but the occupation strip pattern is kept on purpose.

New texts follow the existing "Label: {count}" form, so no plural rules are added. The specs that click the old new-Transfer button in the day band move to `+ Novi transfer`, and the phone filter spec opens the sheet first.
