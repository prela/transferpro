# Office and driver UI: layouts, navigation, and density

Status: accepted

Damir accepted this on 15 October 2026, in the UI/UX round (step 8 of #206). It partially supersedes ADR-0016; the sentence is listed below. ADR-0039 decides the urgent and warning tiers and live refresh. ADR-0040 decides the theme tokens and contrast rules. Steps 9–12 of #206 build on these three records.

## Context

The first review of the demo seed found the office screens sparse and hard to scan. The day board drew every Ride command as its own `xl` button, so a row grew to 120–180 px and two or three Transfers fit on a screen. The office home stacked about ten lines of facts per Ride in full-width cards, with the right side of the screen empty. Its Rides count included finished Rides that no list showed. Language and theme sat as large buttons on the profile page. The invitation form filled the members page above the list. Sign-in was a heading and a form. The dark theme had borders that could not be seen.

The office often works from a phone, not only from a desk. The Charter asks for mobile-first on all roles and WCAG 2.2 AA. The reference operator works from a dense board with a Gantt per vehicle. ADR-0033 keeps a Gantt with drag and drop and the day lock out of v1, and it lets this round bring in an alarm view, a thin day timeline, and faster entry.

The alternatives were a desktop-only office with a horizontally scrolling table on the phone; a density switch; a Ride detail as its own page, or a modal per command as today; an icon-only sidebar by default; an alarm inbox with acknowledge and snooze (ADR-0039); and a split board that merges Home and Transfers around a timeline.

## Decision

### Devices and density

The office (Admin, Dispatcher) has two first-class layouts, desktop and phone. On the phone, Home, the urgent view, Transfers, the Ride detail, assignment, office acceptance by phone, and closing (done, no-show, cancel) are designed for that screen and pass the same checks as on the desktop: e2e at a phone viewport, accessibility, both themes, and both locales. Recording and correcting a Transfer, the catalogs, and settings may be more comfortable on the desktop, but they work on the phone. A horizontally scrolling table is not the phone layout of these screens. The smallest desktop target is 1366×768.

There is one density per layout and no density switch in v1. The office desktop is compact: a table row of 36–40 px, primary data at 14 px, secondary data at 12 px, and controls in a row at 28 px, above the WCAG 2.5.8 minimum of 24 px. Inputs stay at 16 px on every layout. The phone layouts, the office's and the Driver's, use touch targets of 44–48 px. The Charter's "mobile-first, all roles" stands as written.

### Ride detail

One Ride detail serves Home, Transfers, the urgent view, and search. On the desktop the list is a table with one row per Ride. A row carries one contextual action, `Dodijeli` for an unassigned Ride, `Potvrdi telefonom` for a Ride waiting on acceptance, and `Obavljeno` for a Ride in progress, plus a `⋮` menu for the rest. Clicking a row opens a panel of about 420 px on the right. At 1440 px and wider the panel stands beside the table. Below 1440 px it overlays the table instead of squeezing it. Clicking another row replaces the panel's content.

On the phone a list row has two lines: the time, the guest with the passenger count, and the state on the first; from → to, the Driver and Vehicle or "Nedodijeljeno", and the warnings as icon and text on the second. A tap opens the detail full screen with a bar at the bottom holding one primary action and "Više".

The open Ride and every filter live in the URL (`?ride=…`). On the phone, Back from the detail returns to the same list position, with the same filters and the same scroll position. A link to a Ride can be shared.

The detail holds the facts, the warnings, and every Ride command: assign, change the Vehicle, reassign, unassign, accept by phone, record the landing time, done, no-show, and cancel. "Ispravi transfer" opens the Transfer form in the same panel. A modal is kept only for a confirmation: cancel, no-show, unassign, and the overlap confirmation of ADR-0029. On the phone, assignment is a list of Drivers with the roster Vehicle of that day and an overlap hint, with large targets.

### Navigation

The desktop sidebar is grouped and shows an item only to a role that may open it:

- Operativa: Početna, with the count of urgent items (ADR-0039); Transferi; Raspored.
- Katalozi: Naručitelji, Podizvođači, Lokacije, Vozači, Vozila, Cjenik.
- Uprava: Računi; Revizija (Admin); Postavke tvrtke (Admin).

The sidebar opens with labels by default. The user may collapse it to an icon rail, and the choice is kept in `localStorage` as today. The roles for Cjenik and Računi are decided in the grills of those modules.

The top bar shows the screen title on the left, and `+ Novi transfer` and the profile menu on the right. The page body does not repeat the Tenant name or the title.

On the office phone, a bottom bar holds Početna (with the count), Transferi, Raspored, and Više. Više opens the full navigation as a panel. `+ Novi transfer` is a floating action button on Početna and Transferi. In the Ride detail, the action bar replaces the bottom bar.

### Profile menu and settings

The profile menu sits top right on the desktop and on the phone. Its trigger shows the initials and the Tenant name on the desktop, and the initials on the phone. The menu holds the user's email, role, and Tenant; `Moj profil`; language `HR | EN` in one click, saved to the user as today; theme `Svijetla | Tamna | Prema uređaju` in one click, kept per device (ADR-0040); and `Odjava`.

`/profile` is for every role, the Driver included. It shows the email (read only), the role, and the Tenant, with language and theme as small pickers.

`/settings` is the Tenant's settings and is Admin only. Its tabs are Operativa (the six existing fields, two columns on the desktop), Članovi, and later a tab per module that needs one, such as the invoice issuer of step 27, without a new navigation item. A Dispatcher does not see the Tenant's settings.

### Members

The Članovi tab shows `+ Pozovi člana` top right and the member table first: name, email, role, and `⋮` with "Promijeni ulogu" and "Ukloni", each behind a short confirmation. The role select leaves the row. The invitation is a modal with email and role; after sending, the same modal shows the result (sent, or email not sent) and the link to copy. Below the members, "Pozivnice na čekanju" lists each pending invitation with its email, role, and expiry, and "Povuci" revokes it. Sending again is a new invitation. Both the pending read and the revoke are Admin only and use Better Auth calls, with no migration.

### Home

Home opens with a balance of the operational day, its date, and its start hour. The balance is eight counts, the total and seven parts, and the seven parts add up to the total: unassigned, waiting on acceptance, assigned and not started, in progress, done, no-show, and cancelled. ADR-0039 adds the part assigned and not started. A click on a part opens Transfers for that day with that filter in the URL. The balance is for the current operational day only. The lists below may hold Rides of other days, and such a row shows its date.

Each Ride appears once on Home. A Ride with an urgent item is in the "Pozornost" block (ADR-0039). Every other Ride is on its list: Nedodijeljeno (unassigned without an urgent item), Čeka prihvat, or U tijeku. On the desktop, the left column (about 60 %) holds Pozornost, Nedodijeljeno, and Čeka prihvat, and the right column (about 40 %) holds U tijeku and the expiring documents. On the phone they stack in that order under the balance, which takes two rows of compact numbers.

A Home row is the same row as on Transfers: the time, the guest with the passenger count, from → to, the Client, the Driver and Vehicle, the urgent item or warning as text, and one action.

### Transfers

Transfers shows one operational day. The toolbar has `◀ Danas ▶` and a date picker, a search within the shown day (guest, flight, Client reference, tabla) that filters what is loaded, quick filters with counts (Sve, Hitno, Upozorenja, Nedodijeljeno, Čeka prihvat, U tijeku, Zatvoreno), and Client and Driver filters. There are no saved views; a link with its filters serves that purpose. Beside the day picker, a small note names the next seven days that have unassigned Rides, such as "Nedodijeljeno: sutra 2, sub 1", and a click opens that day. The office home read already returns every unfinished unassigned Ride of any day and is loaded on every office screen for the count, so the note should need no new read; step 10 confirms this.

The desktop table has eight columns in pickup order, with no column sorting: Vrijeme (with the date after midnight), Let (with landed or expected time), Gost (with the passenger count, and luggage and child-seat icons), Relacija (with an airport icon), Naručitelj (with the Client reference in small text), Vozač · vozilo (or "Nedodijeljeno"), Stanje (the state and its urgent items and warnings), and Cijena (right aligned, with the payment), followed by the action and `⋮`. The tabla, the note, and the expected arrival move to the detail. Finished Rides stay under Sve, muted; a cancelled Ride says so in text, not by colour alone. An empty day says so and offers `+ Novi transfer`. The first load shows skeleton rows; later loads never empty the list. A view over several days comes after the pilot.

### Occupation strip

On the desktop only, a collapsible strip above the Transfers table shows one row per Vehicle, labelled with that day's roster Driver, across the operational day from its start hour to the next. A block is the Ride's occupation as ADR-0029 defines it: from the pickup, or from a stored landing, for the transfer duration. The relocation gap is not part of the block. A short gap or an overlap shows as a warning outline with text. Unassigned Rides are not on the strip. A line marks now. A block is a button with a full accessible name and opens the Ride detail. The table stays the complete, primary view. The strip needs no server change, and its collapsed state is remembered. It is not shown on the phone; this is the one approved exception to the phone rule above. A Partner row waits for step 13. It is the first UI item on the #206 cut list. It has no drag and drop and no lock.

### Catalogs, roster, and audit

Naručitelji, Podizvođači, Lokacije, Vozači, and Vozila share one pattern: a search over the loaded list, "Prikaži arhivirano" where archiving exists, `+ Dodaj`, a compact table with two-line rows on the phone, and a row that opens the same panel as the Ride detail for viewing and editing. Archiving sits under `⋮` with a confirmation. The Client card of step 18 (contacts, notes, Ride history) appears as tabs in that panel.

On the desktop, Raspored is a week grid: one row per Driver, one column per day, a Vehicle picker per cell that saves at once and shows its status, and `◀ Ovaj tjedan ▶`. It loads the seven existing day reads and saves through the existing per-Driver, per-day write, with no server change. A Vehicle already given to another Driver that day is marked and still selectable; the server keeps its rules. "Kopiraj prošli tjedan" fills only the empty cells from the previous week, overwrites nothing, saves cell by cell, and ends with a summary of what was copied and what was skipped (an archived Vehicle, or a Vehicle already given). The copy is not atomic. On the phone, Raspored is one day, `◀ Danas ▶`, a list of Drivers with large Vehicle pickers.

Revizijski zapisnik (Admin) is a compact table of when, who, action, and detail, with two-line rows on the phone and the manual refresh it has today. It has no automatic refresh and no filters in v1.

### Transfer form and feedback

The form to record or correct a Transfer opens where the detail does. Its basic fields are always shown: Client, date and time, from, to, guest, passengers, Client reference, payment, and price. The Client reference is basic because it is the only tie between an arrival and its return journey (ADR-0003). Step 26 puts the price-list suggestion and its explanation beside the price. "Više" is collapsed and holds the flight number, the airport mark, the tabla, luggage, child seats, and the note; on a correction it opens when one of them has a value. The airport mark stays an explicit choice. Client and Location are searchable selects. "+ Dodaj ‘…’" in either select opens a small form (a Client's name and kind, or a Location's name and address with suggestions) and returns the new record to the Transfer form. After saving, the panel shows the new Ride's detail with `Dodijeli` as its action. Enter submits.

An unfinished new Transfer is kept as a draft in the browser. After an accidental close or a reload, it comes back with "Vraćen nedovršeni unos" and "Odbaci". The draft is never sent to the server. It is keyed by user and Tenant, it is removed on save, on "Odbaci", and on sign-out, and it expires after 24 hours.

Success shows a short toast with `role="status"`. The work-order result per Driver (ADR-0026) shows "sent" in the toast; "no email" and "send failed" stay in the Ride detail until the user closes them. The result names the Driver, not the address. A form error sits beside its field, with a summary at the top of the form and `role="alert"`, and typed data is never cleared. A confirmation is kept for a command that cannot be undone or that unassigns, and it states the consequence. Every list has an empty state that says what is empty and what to do next.

### Faster work and print

On the desktop, Ctrl/Cmd+K opens a command palette (`UDashboardSearch`): every screen, "Novi transfer", and "Idi na dan…". The same palette searches Transfers across days by guest, Client reference, and flight number, and a result opens the Ride detail on its day. On the phone, the search opens from a magnifier in the top bar. The search is a new read in `transfers`, allowed for Admin and Dispatcher, inside the Tenant session, with no migration. It is required for v1 and is not on the cut list, because ADR-0003 has the office find a return journey's arrival by its Client reference.

"Dupliciraj" and "Povratni transfer" sit under `⋮` and in the detail. Both only prefill a new Transfer form; nothing is stored until it is saved. A return journey swaps from and to; keeps the Client, Client reference, guest, passengers, luggage, child seats, and payment; and leaves the time, the flight number, and the tabla empty. It creates no link in the model (ADR-0003, ADR-0036), and each entry gets its own ExternalRef.

"Ispiši dan" on Transfers prints the shown day in light colours, one row per Ride with the tabla and the note, grouped by Vehicle with unassigned Rides last. It is print styling only. A day printed ahead is the paper fallback when the system is down.

### Sign-in

There is one sign-in for everyone and no Tenant picker. After it, office staff land on Home, a Driver on their Rides, and the Superadmin on the platform. Sign-in is a centred card of at most 28rem on the frame surface, with the text mark "Transferpro" and the subtitle "Dispečerski sustav za transfere", email and password, a full-width "Prijavi se", and the error below. A logo may later replace the text mark without a layout change. There is no marketing image and no Tenant colour. Language and theme are small pickers top right. "Zaboravljena lozinka?" is not shown until auth ships it. The invitation screen uses the same frame and card.

### Driver phone

The header shows the Tenant name, today's date, and the profile menu; the large Profile and sign-out buttons leave the list. The theme follows the device by default, with a one-tap choice in the menu.

A "Sljedeća vožnja" card leads: the pickup time in large type and the state; for an airport pickup, the flight number with the landed or expected time; from and to, each with its directions link (ADR-0031); the guest, the passenger count, luggage, child seats, and the note; the tabla, prominent; and the price and payment only for cash (ADR-0009, ADR-0020). One primary action per state fills the width at 48 px: `Prihvati` with "Odbij" beside it while the Ride waits on acceptance; otherwise `Obavljeno`, with "Vrijeme slijetanja" for an airport pickup and "Nedolazak", which is enabled once the wait has passed and says from when until then (ADR-0007). Done, no-show, and decline keep their confirmations. The other Rides follow as compact rows that expand on tap. Expiring documents show as one notice row at the top, only when something expires. The list refreshes as ADR-0039 describes.

"Prikaži tablu" shows the tabla full screen, large and in high contrast, so the Driver can hold up the phone as the meet sign. While it is open, the screen stays on where the browser supports the Screen Wake Lock API. The text fits the screen width and follows the phone's rotation. It needs no server change.

Ride steps beyond accept, done, and no-show (ADR-0022), offline work, and GPS stay out.

### Superadmin

The platform uses the same frame, with a navigation of "Tvrtke" only and the same profile menu.

### Croatian and English labels

These are labels; the terms in `GLOSSARY.md` and in code do not change (ADR-0036). Client is "Naručitelj" / "Naručitelji" (en "Client"). Partner is "Podizvođač" / "Podizvođači" (en "Subcontractor"); the Croatian word "partner" is not used. Tenant is "Tvrtka" everywhere (en "Company"), replacing "Organizacija", "Organization", and "firm"; its settings are "Postavke tvrtke" (en "Company settings"). The audit log keeps the title "Revizijski zapisnik" and is "Revizija" in the navigation (en "Audit log", "Audit"). The roster is "Raspored" in the navigation and "Raspored vozila" as a title. The new modules are "Cjenik" (en "Price list") and "Računi" (en "Invoices").

Actions: accept by phone is "Potvrdi telefonom" (en "Confirm by phone"). In a row, done is "Obavljeno" and no-show is "Nedolazak" (en "Done", "No-show"); the confirmation keeps the full wording, such as "Označi obavljenom". Clear is "Ukloni dodjelu" (en "Unassign").

Short texts in a row: "Nedodijeljeno < 4 h", "Prošlo preuzimanje", "Odbio: {vozač}", "Alarm slijetanja", "Nije zatvoreno", "Preklapanje", "Nesklad rasporeda", "Istekao dokument". The detail shows the full text.

### Nuxt UI and the dashboard template

We keep `UDashboardGroup`, `UDashboardSidebar`, `UDashboardPanel`, `UDashboardNavbar`, `UDashboardToolbar`, `UDashboardSearch`, `UTable`, `USlideover` (the overlaying panel and the phone detail), `UModal`, `UDropdownMenu`, `USelectMenu`, `UBadge`, and the toast. We build, from Reka UI primitives and theme tokens as ADR-0016 requires, the phone bottom bar and floating button, the panel beside the table (a second `UDashboardPanel`), the shared Ride row, the day balance, the occupation strip, the roster week grid, the full-screen tabla, the print layout, and the sign-in card. The template's home layout and its default palette are replaced (ADR-0040).

### Superseded

In ADR-0016, "Controls that are tapped use size `xl`." Size `xl` now applies only to the phone layouts, the office's and the Driver's. On the office desktop, a control in a table row is 28 px.

### Out of this record

Recurring Rides, an assignment suggestion, keyboard shortcuts beyond Ctrl/Cmd+K and Esc, a signed PDF work order, Driver and Vehicle documents with files, and GDPR export are not decided here. They are not ruled out.

## Consequences

Every e2e spec for the listed office screens runs at a phone viewport as well as on the desktop, in both themes and both locales, so the specs that pin today's shell, Home, Transfers, settings, and the user menu change in steps 10–12. The five separate Ride command modals and inline forms become one panel.

Three things are new behaviour beyond a layout pass: the pending-invitation list with revoke, the Transfer search across days, and the quick add of a Client or a Location from the Transfer form. The search is the only new read, and the seven-day note should not need one. Neither needs a migration.

The roster copy can end half done when a cell is refused. It shows which cells were skipped. An all-or-nothing copy would need a batch write on the server.

The draft keeps a guest name and a flight number in the browser for up to 24 hours on that device. Keying it by user and Tenant and removing it on sign-out keep it from the next person on a shared office computer.

The occupation strip is the first UI cut if time runs short. The table and the overlap warning still show occupation without it.

Sign-in has no password recovery until auth ships it. Password change and "forgot password" are a pilot requirement, decided on the auth tier and not here.
