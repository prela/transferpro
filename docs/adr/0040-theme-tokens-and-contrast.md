# Theme tokens and contrast rules

Status: accepted

Damir accepted this on 15 October 2026, in the UI/UX round (step 8 of #206). It partially supersedes ADR-0016; the sentences are listed below. The rest of ADR-0016 stands, including Nuxt UI as the only UI library, the system typeface, and the `transferpro-theme` key.

## Context

The dark theme had borders and surfaces that could not be told apart: cards, tables, and the sidebar sat on nearly the same shade, and structural borders measured about 1.5:1 against their surface. ADR-0016 set `neutral` to `stone` and set no tokens for borders and surfaces per theme. Its toggle wrote only `light` or `dark`, so a user who chose once could not return to following the device. A design proposal for this round claimed control borders of at least 3.1:1; measured, they were 2.56:1 in light and 2.36:1 in dark, below WCAG 1.4.11.

The alternatives were to keep `stone` with corrected tokens, to load Inter as a local webfont, and to make dark the default on the Driver's phone.

## Decision

### Colours and surfaces

`neutral` is Tailwind `slate`. `primary` stays `blue`. Each theme has four surface levels: the app frame, the working surface, the raised panel (side panel, menus, modals), and the hovered or selected row. The dark theme has its own tokens, not an inversion of the light ones.

### Contrast rules

These rules bind both themes. The starting values are measured and may change only while the rules still hold.

- Text, secondary text included, is at least 4.5:1 on every surface it sits on. Start: slate-600 in light and slate-400 in dark (7.58:1 and 5.71:1 on the panel).
- The boundary of a control (input, outline button, checkbox, focus ring) is at least 3:1 on every surface (WCAG 1.4.11). Start: slate-500 in light (4.55–4.76:1) and `#7A8BA3` in dark (4.21–5.14:1).
- A structural border (card, panel, table row line, sidebar) in the dark theme is at least 2:1 against both surfaces it separates. This is our rule; WCAG does not require it. Start: slate-300 in light and `#526077` in dark (2.30–2.80:1).
- Text on a state badge is at least 4.5:1.

A unit test computes the contrast of every token pair in both themes and fails when a pair drops below its rule. The e2e suite runs axe (`@axe-core/playwright`) on every screen ADR-0038 lists for the phone, in both themes. The owner approves installing that dev dependency in step 10.

### States

A Ride state is icon, text, and colour: unassigned in warning; waiting on acceptance in warning, outlined; assigned in neutral; accepted in primary; in progress in info; done in success; no-show in error, outlined; cancelled in neutral, muted. `secondary` (indigo) is kept for a Partner once step 13 decides how a handoff fits the Ride states.

### Type and shape

The typeface stays `system-ui`, with no webfont. Times, amounts, and counts use `tabular-nums`. Registration plates and flight numbers use the monospace stack. The radius is 6 px.

### Theme choice

The theme choice has three options: light, dark, and follow the device. It is kept per device under `transferpro-theme`, and follow the device is the default for every role, the Driver included. The choice sits in the profile menu, on the profile page, and on sign-in (ADR-0038).

### Superseded

In ADR-0016, "`neutral` is `stone`, in place of the old paper `#f4f1ea` and ink `#1c1915`." and "A toggle writes only `light` or `dark`, never `system`."

## Consequences

The dark theme becomes legible by rule, and a later palette change cannot quietly break contrast, because the token test fails first. The warm paper-and-ink look of ADR-0016 is gone.

A Driver who wants dark at night gets it from the phone's own night setting without touching Transferpro, and keeps the light theme in daylight. Distinguishing `I`, `l`, and `1` in flight numbers rests on the monospace stack instead of a webfont, so no font is downloaded.

axe adds a dev dependency and time to the e2e run.
