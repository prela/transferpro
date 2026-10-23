# Urgent and warning tiers, and live refresh

Status: accepted; partially superseded by ADR-0045, ADR-0046, ADR-0051, and ADR-0055

Damir accepted this on 15 October 2026, in the UI/UX round (step 8 of #206). It partially supersedes ADR-0023, ADR-0024, ADR-0027, and ADR-0030; the sentences are listed below. ADR-0032 stands: every alarm and warning is derived when the page is read, nothing is stored, and nothing is sent. ADR-0038 places these on the screens.

## Context

The office home showed the unassigned alarm, the unclosed mark, and the landing alarm as lines inside full-width cards, with every flag the same weight. The reference operator shows every silent alarm as a wall of cards at the top of every page. The first Tenant's main pains are forgotten Rides and no-shows. An unassigned Ride whose pickup had passed carried no mark of its own. The office home did not poll, so an open page gained no alarm until someone pressed Refresh, and Refresh gave no sign that anything happened. Its counts did not add up to what the lists showed.

The alternatives were an alarm inbox with acknowledge and snooze, which needs a store and a migration; one flat level for every flag; server push (SSE or a websocket); and manual refresh with a timestamp.

## Decision

### Two tiers

Everything the office is asked to look at is in one of two tiers, and each is shown as icon, text, and colour, never colour alone.

**Urgent** (Hitno) asks the office to act now: an unassigned past pickup, an unassigned alarm (ADR-0023), a decline alert, a landing alarm (ADR-0030), and an unclosed mark (ADR-0027). The unclosed mark is urgent because it is the only sign that a Ride was forgotten.

**Warning** (Upozorenje) is attached to a Ride, does not block, and asks for no action now: an overlap warning or a gap shorter than the relocation gap, a roster mismatch, and an expired-document warning.

An unassigned past pickup is an unfinished unassigned Ride whose pickup is in the past. It is derived on read like the others and sends nothing. Expiring documents within 30 days are information on Home, in neither tier.

### Where they show

Home opens its lists with the "Pozornost" block: every Ride with an urgent item, grouped by kind, a count per group, one row per Ride with its action, and a row that opens the Ride detail. A Ride in Pozornost is not repeated on its own list. The Početna item in the sidebar and in the phone bottom bar carries the count of urgent Rides. On Transfers, a row shows each item as icon and short text, and the quick filters "Hitno (n)" and "Upozorenja (n)" narrow the day. The Ride detail shows the full text of each at the top. No page shows a strip of alarms across its top.

There is no acknowledge and no snooze in v1. An urgent item ends when its cause ends: the Ride is assigned or closed. A decline alert ends when the Ride is assigned again, as today.

### Counts

The office home read returns eight counts for the current operational day: the total and seven parts. The new count is the part assigned and not started: an assigned or accepted Ride whose pickup is still ahead and that is not waiting on acceptance. With it, the seven parts add up to the total: unassigned, waiting on acceptance, assigned and not started, in progress, done, no-show, and cancelled. The three lists and the eight counts still come from one read taken at one moment.

### Live refresh

Home, Transfers, the Driver's list, and the urgent count refresh every 60 seconds while the tab is visible, at once when the tab becomes visible again or the phone is unlocked, and after the user's own command. A hidden tab sends no request.

Beside "Osvježi" the screen shows "Ažurirano u 10:32" and a spinner while a load runs. A failed refresh keeps the last data on screen and says "Nije osvježeno, zadnje u 10:32"; the list is never emptied. A refresh does not move the open panel, the scroll position, the filters, or keyboard focus. The open Ride detail refreshes with its list. When that Ride changed while one of its forms is being edited, the form is not replaced; it shows "Vožnja je promijenjena" instead.

A switch "Automatsko osvježavanje" sits beside the refresh time and starts on, so the user can stop content that updates on its own (WCAG 2.2.2). A screen reader hears a polite announcement (`aria-live="polite"`) only when a new urgent item appears, not on every refresh. There is no sound and no browser or phone notification in v1.

### Superseded

In ADR-0024, "The page does not poll." and "seven" in "the seven counts"; the read now returns eight counts, the total and seven parts.

In ADR-0023, "The office home shows that mark on the unassigned list." The office home shows that Ride in Pozornost. The read still returns it on the unassigned list.

In ADR-0023's consequences, "After pickup it stays on the list under the #29 warning". After pickup the Ride is an unassigned past pickup, which is urgent and shows in Pozornost. The read still returns it on the unassigned list, and the four-hour mark still does not apply.

In ADR-0027, "The list stays every in-progress Ride. The mark is a flag on the row. There is no fourth list and no extra count." On the office home, a marked Ride shows in Pozornost and counts toward the urgent count. The read still returns it on the in-progress list.

In ADR-0027's consequences, "The office home does not poll, so a page left open does not gain the mark until the next read." A visible page gains the mark at its next refresh, within 60 seconds, unless the user has switched automatic refresh off.

In ADR-0030, "The office home shows it on the in-progress list" and "There is no extra list and no extra count." On the office home, the Ride shows in Pozornost and counts toward the urgent count. The read still returns it on the in-progress list.

In ADR-0030's consequences, "The office home and the day board do not poll, so a page left open does not gain the alarm until the next read." A visible page gains the alarm at its next refresh, within 60 seconds, unless the user has switched automatic refresh off.

## Consequences

The office sees a forgotten Ride within a minute without pressing anything, and a page left open no longer goes stale. A Ride with an urgent item leaves its list on Home, so Home never shows the same Ride twice, and the balance always adds up.

Nothing can hide an urgent item, which is the point, but a busy day with several unclosed Rides keeps them all in Pozornost until each is closed. An acknowledge or snooze later needs a new ADR and a store, as ADR-0032 says.

Polling costs one office home read per open office tab per minute, and one upcoming-Rides read per open Driver tab. At the first Tenant's size that is negligible.

The warning on a changed Ride is shown only in the browser. A save sent after it still writes over the other change, because the server does not refuse a stale save today. Refusing one is a decision about the write path and the strongest tier, not this record.
