# 266 Driver next ride

Out of scope: full-screen "Prikaži tablu" is #267. No server change and no migration.

## Decisions

- The next Ride is the earliest `pickupAt`, then `rideId`. It stays open. Later Rides are compact rows. A tap opens that row and leaves the others as the Driver left them. A refresh keeps every opened row that is still on the list. Leaving for Profile and coming back starts compact again, because that state lives on the page.
- "Nedolazak" names the wait (ADR-0007). When both ends fall on the same calendar day in the Tenant zone, the label is the clock only ("od 10:00 do 10:25"). When the window reaches the next calendar day, each end is the full instant.
- Decline stays on an assigned Ride that does not require acceptance (ADR-0006). Waiting on acceptance is Prihvati with Odbij beside it.
- The expiry notice renders nothing when the list is empty. The office list is unchanged.
- The office landing spec stays on the desktop project. The phone day row does not print the flight cell, so a separate `@phone` test records the landing from the next Ride.
- Merged `origin/develop` (#262 company settings, #282 firm list and the isolated e2e database). The existing-account invite spec keeps the next-ride assertions and the member-invite assertions.

`pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` passed (592 tests). `pnpm test:e2e` passed: 246.

Changed specs, rewritten rather than deleted:

- `e2e/driver-rides.spec.ts` — labels are Prihvati, Odbij, Obavljeno, and Nedolazak with the wait window; later rows open through `showRide`; Nedolazak stays disabled and names from and until; live refresh is 60 seconds, a hidden tab, and "Ažurirano u" after the Driver's own accept; `@phone` covers accept, done, decline, and no-show, plus axe in light and dark and once in English, with a cash card on screen. After Profile the test opens the later rows again.
- `e2e/driver.spec.ts` — an empty Driver home no longer shows the documents heading or region.
- `e2e/office-home.spec.ts` — the Driver home is "Sljedeća vožnja" and has Osvježi; it has no "Osvježi dokumente" and no documents region when nothing expires. Office home is unchanged.
- `e2e/expiring-documents.spec.ts` — the Driver notice is one row that expands to that Driver's own licences. An unlinked Driver has no region and no empty sentence.
- `e2e/correct-transfer.spec.ts` — the Driver decline button is "Odbij". The dialog confirm stays "Odbi".
- `e2e/record-landing-time.spec.ts` — the Driver button is "Vrijeme slijetanja". The office flow stays untagged because the phone day row has no flight cell. `@phone` is a Driver-only test that records the landing from the next Ride.
- `e2e/accept-invite-existing.spec.ts` — a Driver lands on "Sljedeća vožnja" and does not see the documents heading. The member-invite assertions from develop stay ("+ Pozovi člana" is absent).
- `e2e/office-roles.spec.ts` — a Driver sees "Sljedeća vožnja" and the documents heading count is 0. A Dispatcher still sees that heading. Develop's member and Operativa assertions stay.
- `e2e/settings-profile.spec.ts` — the English Driver heading is "Next ride".

## Code review

Fixed point `origin/develop` (`c6ce3d0`). The reports below are the review of `74b9453`.

### Standards

**Hard**

**ADR-0040, "Times, amounts, and counts use `tabular-nums`."** Pickup time, price, luggage, child seats, and the document count use it. These new times and the compact-row count do not:

```198:203:app/components/DriverRideCard.vue
        <p v-if="ride.landingAt">
          <time :datetime="ride.landingAt">{{ pickupLabel(ride.landingAt) }}</time>
        </p>
        <p v-else-if="ride.expectedArrival">
          {{ t('driverRides.expectedArrival') }}
          <time :datetime="ride.expectedArrival">{{ pickupLabel(ride.expectedArrival) }}</time>
```

```152:152:app/components/DriverRideCard.vue
      <span class="min-w-0 flex-1 truncate">{{ ride.guestName }} · {{ ride.passengerCount }}</span>
```

The no-show label is also a pair of times inside a button with no `tabular-nums` (`noShowLabel` in the same file). The refresh sentence matches `OfficeHome.vue` / `TransferDay.vue`, so that line is not a new breach.

Both locales were updated together. Instants still go through `formatInstant` (`clockLabel` only slices it). Glossary identifiers are unchanged. Driver targets are `min-h-12` (48px) on Nuxt UI controls. No new tenant route or personal-data log.

**Judgement**

**Duplicated Code.** The no-show clock is built twice. The card enables "Nedolazak" from `noShowClock`; `openMarkNoShow` refuses the click unless `canNoShow` rebuilds the same object:

```66:72:app/components/DriverRideCard.vue
const noShowClock = computed(() => ({
  airport: props.ride.airportMark,
  pickupAt: new Date(props.ride.pickupAt),
  landingAt: props.ride.landingAt === null ? null : new Date(props.ride.landingAt),
  airportWaitMinutes: props.airportWaitMinutes,
  elsewhereWaitMinutes: props.elsewhereWaitMinutes,
}))
```

```125:136:app/components/DriverRides.vue
function canNoShow(ride: DriverUpcomingRide): boolean {
  // ...
  return noShowWaitElapsed({
    airport: ride.airportMark,
    pickupAt: new Date(ride.pickupAt),
    landingAt: ride.landingAt === null ? null : new Date(ride.landingAt),
    airportWaitMinutes: airport,
    elsewhereWaitMinutes: elsewhere,
  }, new Date())
}
```

The from/to directions blocks in `DriverRideCard.vue` are the same button twice. That shape was already in `DriverRides.vue`; the move did not extract it.

**Divergent Change.** `ExpiringDocuments.vue` now owns the office list and the driver notice (`variant: 'list' | 'notice'`), so one file changes for two screens.

**Data clump.** `airportWaitMinutes` and `elsewhereWaitMinutes` are separate props on every card, then folded into `NoShowClock`, which already exists in `shared/no-show.ts`.

### Spec

#### (a) Missing or partial

None. The header (Tenant name, today’s date, profile menu), the lead card, compact rows, the expiry notice, 60s visible refresh plus refresh after the Driver’s own action, cash-only price, confirmations, `@phone` axe in light and dark and once in English, and the same-day clock window are in the diff. No server files and no migration.

#### (b) Scope creep

None that the ticket did not already require. Client, client kind, address, and plate are the previous card, still asserted by the rewritten Driver e2e.

#### (c) Implemented, but wrong

**Landed time is not identified as landed.** “for an airport pickup the flight number with landed or expected time.” A recorded landing is only `formatInstant` under the flight number (`DriverRideCard.vue`). The expected case is labeled “Očekivani dolazak” / “Expected arrival”, not the office pair “Sletio {time}” / “Očekivano {time}” (“Landed {time}” / “Expected {time}”).

**A non-waiting assigned Ride still has a second full-width action.** “One primary action per state, full width at 48 px: `Prihvati` with "Odbij" beside it while waiting on acceptance; otherwise `Obavljeno`, with "Vrijeme slijetanja" … and "Nedolazak".” Waiting (`assigned` and `mustAccept`) shows Prihvati and Odbij. `assigned` with `mustAccept` false is not that state, and the card still renders a 48px full-width Odbij under Obavljeno (`canDeclineRide` is any `assigned` Ride).
