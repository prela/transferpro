# 261 Occupation strip

Desktop strip above the Transfers table. No server change and no migration.

## Decisions

- A block is the ADR-0029 window: it opens at the pickup and ends at the stored landing plus the transfer duration, or at the pickup plus that duration. A landing shifts the end. The start stays the pickup. An empty window (the duration finishes before the pickup) is omitted.
- The relocation gap is not drawn. A true overlap and a short gap both use the short row word (Preklapanje / Overlap) plus a warning outline. A gap equal to the relocation gap is quiet. The button is the occupation window; the caption sits under it and does not widen the click target.
- Rows are roster Vehicles for that day, plus any Vehicle that has an assigned or accepted Ride. The label is the roster Driver. Unassigned, done, no-show, and cancelled Rides are absent.
- Placement uses the Tenant's transfer duration and relocation gap from the existing settings read, and the day's roster from the existing roster read. The filtered table does not hide blocks.
- Collapsed state is `localStorage` per Tenant and user (`transferpro-occupation-strip:<tenant>:<user>`). Absent means open.
- The strip is `hidden` below the `lg` breakpoint (the phone layout). That is the ADR-0038 exception.

## Tests

`pnpm lint`, `pnpm typecheck`, and `pnpm test` (546) passed. e2e was not run: another agent is using this machine.

Changed specs:

- `e2e/occupation-strip.spec.ts` — new. No earlier spec asserted that the strip was absent, so none was rewritten. This spec is the accessible name, the Ride detail, the warning word, collapse across reload, English in the dark theme, and absence at 390 px.
