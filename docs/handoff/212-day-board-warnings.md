# 212 Day-board warnings

Out of scope: office home, the Driver phone, refusing a command, and storing or sending a warning.

## Decisions

- Warnings are derived in `listTransferDay` on that read. `shared/board-warnings.ts` `deriveBoardWarnings` is the pure rule. Overlap calls `judgeSchedule` unchanged. A tight gap and a true overlap are one warning. Do not store a warning, do not scan on a schedule, and do not add an endpoint.
- Expiry is compared to the calendar date of the pickup in the Tenant time zone, not the operational day. The stored day is the last valid day. Kind order stays `EXPIRING_DOCUMENT_KINDS`.
- Roster mismatch is only when the Ride's Vehicle has a roster row for a different Driver that calendar date. No row is not a mismatch. A stored row for an archived Vehicle still counts. The Ride's own Vehicle is used even when archived.
- A neighbour is any other assigned or accepted Ride that shares the Driver or the Vehicle and whose occupied window can reach the viewed day, including a pickup before the search window whose landing is after it. The neighbour is not added to the day list. The overlap warning does not name the other guest.
- `loadDriverDocumentExpiry`, `loadVehicleDocumentExpiry`, and `rosteredDriversOnDates` are transaction reads through each module index. #220 gives each one the session role and refuses anyone who is not an admin or a dispatcher before the query. Callers pass `actor.role`. Do not drop that argument. `listTransferDay` still calls `officeOnly` before `applyBoardWarnings`. Older loaders such as `loadDrivers` stay as they are.
- The day board prints each warning as text in the status cell, next to the landing alarm. Copy is `transfers.warnings` in both locales. Refresh calls the same day read again. The cell's accessible name is the state plus those lines, so an exact match on the state alone fails once a warning is present.
- A board spec that fills `#transfer-day` must call `hydrated()` first. The server paints the operational day before Vue starts, and a fill in that gap is overwritten.

## Code review

Reviewed `299eb65` against `origin/develop`, then the spanning-neighbour load and the 390×844 viewport assert were added.

## Standards

### Hard

**Role allow-list.** `loadDriverDocumentExpiry`, `loadVehicleDocumentExpiry`, and `rosteredDriversOnDates` are public module exports that return tenant rows and do not check the role. `AGENTS.md` (Security): every loader or helper that returns tenant data enforces the allow-list itself and does not rely on the caller. `listTransferDay` still calls `officeOnly` before `applyBoardWarnings`, so the day route is covered. The new exports are not.

### Judgement

**Duplicated Code.** The same empty-list, validate, `in (...)` shape is copied in `drivers.ts`, `vehicles.ts`, and `roster.ts`:

```109:116:server/modules/drivers/infrastructure/drivers.ts
export async function loadDriverDocumentExpiry(
  transaction: TenantTransaction,
  driverIds: readonly string[],
): Promise<DriverDocumentExpiry[]> {
  const unique = [...new Set(driverIds)]
  if (unique.length === 0)
    return []
  if (unique.some(id => !z.uuid().safeParse(id).success))
```

`loadVehicleDocumentExpiry` and `rosteredDriversOnDates` repeat that skeleton with a different column list.

**Repeated Switches.** Assigned-or-accepted is decided twice. `applyBoardWarnings` filters `ride.state === 'assigned' || ride.state === 'accepted'`, then `deriveBoardWarnings` returns empty unless `state !== 'assigned' && state !== 'accepted'`.

### Checked, not breaches

Transfers reach Drivers, Vehicles, and Roster through each `index.ts` and do not join those tables (`docs/adr/0018-module-boundaries.md`). The scatter across those modules is that rule, so Shotgun Surgery does not apply. Warnings are derived on the day read, not stored, and nothing is sent (`docs/adr/0032-board-warnings-derived-on-read.md`). Glossary terms **Expired-document warning**, **Roster mismatch**, and **Overlap warning** match the fields and the copy, and the avoid-words (`conflict`, `ride_overlap`, `reminder`) are unused. Both locales ship, and the UI change adds `e2e/board-warnings.spec.ts` (`docs/agents/working-rules.md`, i18n; `AGENTS.md`). The tenant-isolation test is present.

## Spec

### (a) Missing or partial

**Phone layout is only asserted, not laid out.** "As a dispatcher on a phone, I want the board and its warnings readable at 390×844" and "Light and dark, plus a 390×844 layout." Warnings are extra lines in the status cell of the existing `overflow-x-auto` / `whitespace-nowrap` table (`TransferDay.vue`). The e2e sets 390×844 and checks the strings are in the row. It does not show that the status column is on screen at that width.

### (b) Scope creep

None. The refresh control, glossary entries, and ADR-0032 match the issue. No new endpoint, migration, command change, home-list change, mail, or audit write.

### (c) Implemented, but wrong

**A spanning neighbour is dropped.** "The read loads every other `assigned` or `accepted` Ride that shares a Driver or a Vehicle with a listed Ride and whose occupied window plus the relocation gap could reach it… The bound must cover the largest transfer duration and relocation gap settings (1440 minutes each) and a stored landing."

`loadNeighbours` keeps a row only when `pickup_at` or `landing_at` sits in `[day start − 2880min, latest listed basis + 2880min)`. A neighbour whose pickup is before that window and whose landing is after it is not loaded, so neither Ride gets the overlap warning, even though the occupied window (ADR-0029: pickup through landing plus duration) covers the day. A landing inside the window is loaded. The integration case only uses pickups about 40 minutes apart.

Everything else checked matches the issue: five document kinds in existing order, expiry strictly before the pickup calendar date, roster mismatch only when that vehicle has a row for another driver (including an archived vehicle), one overlap warning via `judgeSchedule` (touching gap and exact relocation gap), empty warnings unless `assigned` or `accepted`, neighbour ids not added to the day list and not shown as a guest name, both locales, same-transaction read, driver 403, and tenant isolation.
