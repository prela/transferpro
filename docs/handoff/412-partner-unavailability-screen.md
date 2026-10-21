# 412 Partner unavailability: screen and e2e

Out of scope: the hard block (`fully_booked`) stays on #413. The Partner Vožnje tab stays on its later ticket.

## Decisions

- Nedostupnost is the second tab on an opened Partner. Podaci stays first. The add form has no tabs. The tab reuses the Driver and Vehicle window form.
- The roster week grid is unchanged. Partners are not rows on it.
- The shared confirmation and the ride-detail sentence name a driver, a vehicle, or a subcontractor. The short board mark stays Nedostupan.
- The audit detail names Podizvođač when the window's partner id is the one set, so a Partner window is not shown as a Vehicle.
- No migration and no new command. The screen uses the #411 routes. `confirm: true` is sent only after 409 `ride_unavailable` or `ride_overlap`.
- The reports below are verbatim.

## Code review

Reviewed `feature/412-partner-unavailability-screen` against `origin/develop`.

## Standards

No hard documented-standard breaches. Both locales ship (`docs/agents/working-rules.md`, i18n). Instants stay on `formatInstant` / `formatCalendarDate`. The panel is Nuxt UI (`UTabs`, the existing window form, `RideOverlapDialog`). Labels stay Partner in code, Podizvođač / Subcontractor in the UI (`GLOSSARY.md`, ADR-0038). Audit still shows an id and field names, never the instants (`docs/adr/0034-capacity-module.md`). `confirm: true` is only sent for `ride_unavailable` / `ride_overlap`. No new module import.

**Judgement call — Repeated Switches.** `app/components/UnavailabilityWindows.vue` cascades on `owner` twice:

```ts
const collection = computed(() => {
  if (props.owner === 'driver') return 'drivers'
  if (props.owner === 'vehicle') return 'vehicles'
  return 'partners'
})
const ownerBody = computed(() => {
  if (props.owner === 'driver') return { driverId: props.resourceId }
  if (props.owner === 'vehicle') return { vehicleId: props.resourceId }
  return { partnerId: props.resourceId }
})
```

`app/components/AuditLog.vue` makes the same choice again:

```ts
t(entry.data.driverId !== null
  ? 'unavailability.ofDriver'
  : entry.data.vehicleId !== null
    ? 'unavailability.ofVehicle'
    : 'unavailability.ofPartner')
```

One owner-to-path-and-body map, and one id-to-label map, would do. ADR-0034's "exactly one id" does not require the second cascade.

## Spec

**(a) Missing or partial.** None. "On the Partner detail the office records Nedostupnost with the same from–to form and whole-day shortcut as for Drivers and Vehicles" — the edit panel keeps Podaci first and adds Nedostupnost via the shared `UnavailabilityWindows` (list, from–to, whole-day shortcut), posting `partnerId` to the #411 window routes. "Croatian and English, light and dark" and "Croatian UI says Podizvođač" — both locales; Croatian uses Podizvođač. "The roster week grid does not change" and "Partners are not on the roster" — no roster files in the diff; the e2e asserts the partner is absent from Raspored vozila. "The board shows the unavailability warning (Nedostupan) … on the Warning tier" — the existing Warning-tier mark; the e2e sees Nedostupan on the handed-off row and under Upozorenja. "E2e: record a Partner window, see the warning, and confirm a handoff … Croatian copy, one English smoke, light and dark, and axe" — one new spec does that, including `confirm: true` and "One confirmation passes an unavailability." "No migration and no new command" and "No test weakened or removed" — neither is present; the driver e2e only updates the shared dialog title.

**(b) Scope creep.** None. The audit line that names Podizvođač stops a Partner window (both other ids null) from being shown as a Vehicle. Shared sentences that now mention a subcontractor are the one form and the one confirm dialog this screen reuses.

**(c) Implemented but wrong.** None. The handoff dialog is the unavailable confirmation, the first tab stays Podaci, and Vožnje is not added.
