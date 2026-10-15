# 243 dispatcher day prototype

Out of scope: merging this branch, opening a pull request, and recording the owner's verdict.

## Decisions

- The branch is `chore/206-prototype`, from `develop`. The shell guard refuses `prototype/*`, so this name replaces the `prototype/206-ui` name in #243. It is not merged and it does not open a pull request.
- `pnpm prototype` serves the screens. Open `/prototype?variant=adr-36`.
- `?variant=` is `adr-36`, `adr-40`, `lift-36`, or `lift-40`. `adr` keeps the measured panel `#1e293b`. `lift` uses frame `#070d18`, working `#10192a`, panel `#1c283c`, hover `#263246`. Every dark surface stays at least 2:1 against the structural border `#526077`. Row height is 36 or 40 px.
- The owner chooses the dark surfaces, the row height, and any ADR-0040 starting value that must change. Do not write that verdict.
- After the review below, the token line is on screen at every width. A phone Ride detail still covers that bar.

## Code review

### Standards

### Hard

**i18n** (`docs/agents/working-rules.md`: both locales). Chrome copy is in `hr` and `en`. Ride facts are not. `app/prototype/day.ts` stores Croatian `flightNote` (`'sletio 06:28'`, `'očekivan 08:02'`) and `note` (`'Tabla na izlazu iz dolazaka.'`). Driver and Ride detail render them in either locale. `money()` in `app/prototype/present.ts` always uses `Intl.NumberFormat('hr-HR', …)`.

**Density** (ADR-0038: secondary type 12px, phone targets 44–48px, inputs 16px). `Home.vue` balance labels are `text-[11px]`. `RideRow.vue` row action is `class="h-7"` (28px) on the phone list. `OfficeShell.vue` new-transfer button is `size="lg"` with no 44–48px height. `Transfers.vue` search `UInput` and both `USelect`s do not set 16px.

**State colour** (ADR-0040: icon, text, and colour). `Driver.vue` paints the next ride with a fixed `UBadge color="warning" variant="outline"` instead of `stateBadge()`. List badges are text and colour only, with no state icon.

**Nuxt UI** (working-rules; ADR-0038 builds the shared row and the phone list from Nuxt UI / Reka). `RideRow.vue` and `Driver.vue` use a native `<button>` for the row.

**Row labels** (ADR-0038). The short texts are `Nedodijeljeno < 4 h` and `Istekao dokument`. Copy uses `Nedodijeljeno uskoro` and `Istekli dokumenti`.

Not scored: no `e2e/` spec. This branch is the throwaway the review was told not to treat as a violation. No tests removed or weakened. No deep imports. Icons are `i-lucide-*`. Both themes are wired. Glossary UI terms (Naručitelj, Podizvođač, Tvrtka) match ADR-0038.

### Judgement

**Duplicated Code.** The same `ping()` toast is copied in `OfficeShell.vue`, `Home.vue`, `Transfers.vue`, `RideDetail.vue`, and `Driver.vue`. Light surface hex is repeated in `layouts/prototype.vue` and `prototype/tokens.ts`.

**Repeated Switches.** `stateBadge()` and `rowAction()` in `present.ts` are separate `if` cascades on `RideState`.

**Mysterious Name.** `ping` is the command stub.

### Spec

### (a) Missing or partial

- “Screenshots of both screens in both themes are posted on this ticket, with the branch pointer.” Light and dark shots of Home, Transfers, and the driver card at 1366, 1440, and 390 px are in `docs/prototype/shots/`. Posting on the ticket is not in this diff.
- “The owner's verdict is recorded on this ticket.” No verdict is in this diff. None is invented here.
- “Home and Transfers with the Ride detail panel at 1366, 1440, and 390 px.” Transfers shots show the panel (overlay at 390, dock at 1440). Home shots at 1366 and 390 are the list only. The panel opens on Home only with `?ride=`.
- “The Driver's ‘Sljedeća vožnja’ card and ‘Prikaži tablu’.” The button is in `Driver.vue`, and separate tabla shots exist. The driver screenshots stop at Prihvati / Odbij, so that control is not in those frames.

### (b) Not asked for

- Catalog and admin items (Raspored, Naručitelji, Podizvođači, Lokacije, Vozači, Vozila, Cjenik, Računi, Revizija, Postavke) that only toast. The spec asks for Home, Transfers, and the driver card.
- HR/EN, system theme, Google Maps links, and a screen wake lock on the sign. “Variants via `?variant=` only where the ADRs leave room: the dark surface shades and the table row height (36 or 40 px).”
- Tomorrow, Saturday, and yesterday (four rides) plus a day switcher. “Static in-memory data: one operational day of about 25 Rides.”
- `app/app.config.ts` sets slate neutral and blue primary for the whole app, not only `/prototype`.

### (c) Implemented but wrong

- “Variants switch via `?variant=` and the current variant and token values are shown on screen.” At 1366 and 1440 the bar shows the hex values and contrast. At 390, `TokenBar.vue` hides those values below the `lg` breakpoint (`hidden … lg:inline`), so only the variant name and “Redak 36 px” appear. 390 px is a required width.

One command (`pnpm prototype` in `docs/prototype/206-ui.md`), the unmerged branch, the 25-ride day (every state, urgent kind, and warning), `?variant=` for `adr`/`lift` and 36/40, and no prototype tests match the spec.
