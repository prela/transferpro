# 414 Popunjeno screen

Out of scope: the duplicated fleet readers stay on #432.

## Decisions

- The warning on save is a toast. The form closes, so an alert inside it would go with the panel. Create and correct share that toast.
- The refusal reuses the overlap dialog and hides the confirm button. A vehicle change, a reassignment, and a partner change use it too, because those commands return the same 409.
- The English dialog avoids "available". The glossary says Free.
- The e2e marks the Driver, the Vehicle, and the Partner unavailable from 11:00 to 14:00. A free Driver and a free Vehicle keep the window open even when the Partner is away. The 18:00 control stays free.
- The compact-row spec keeps a free Partner so the row stays one line. The height bound is unchanged.
- Coverage of the capacity domain and application is unmeasured. No package was installed. No migration. `pnpm test:rls` was not required.
- After the review, the English dialog body no longer says "available". The compact-row spec gained a free Partner during conclude. The reports below are verbatim, before those follow-ups.
- Conclude checks: `pnpm exec nuxi build`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` (928) passed. `pnpm test:e2e` passed (331, 6.2m) on `transferpro_e2e`. `pnpm audit --audit-level=high` exited 0 (2 low, 1 moderate; 2 high ignored).

## Code review

Reviewed `feature/414-popunjeno-screen` against `origin/develop`. The reports below are verbatim.

## Standards

The diff holds to the documented UI, module, and capacity rules. Both locales gain the same four keys (`fullyBooked`, detail, title, body). The mark uses `i-lucide-ban` from the installed Lucide set. The save toast uses semantic `warning`. `e2e/fully-booked.spec.ts` covers light and dark. UI imports stay on `shared/index.ts` (ADR-0018). `classifyRideAttention` keeps fully booked a Warning only while the Ride is unassigned, and `RideOverlapDialog` hides confirmation (ADR-0034; `GLOSSARY.md` Fully booked / Warning). Partner copy stays "subcontractor" / "podizvođač" (ADR-0038). "Fully booked" / "Popunjeno" match the glossary.

**Documented breach (wording).** `GLOSSARY.md` **Free** says `_Avoid_: available`. `i18n/locales/en.json` `ride.fullyBookedBody`: "No free driver with a free vehicle, and no free subcontractor, is available then." The Croatian line stays on "slobodnog".

**Judgement — Mysterious Name.** `CapacityDialogReason` now includes a refusal that confirmation does not pass, and the holders still say confirm and overlap:

```
const overlapOpen = ref(false)
const confirmReason = ref<CapacityDialogReason>('overlap')
```

Same shape in `RideAssign.vue`, `RideReassign.vue`, `RideVehicle.vue`, and `transfer-form.ts`. `RideHandOff.vue` uses `confirmOpen` / `confirmReason`. In `RideOverlapDialog.vue`, `blocked` only means "hide the confirm button" (`v-if="!blocked"`), and the component name still says overlap.

**Judgement — Repeated Switches.** Title and description repeat one cascade on `reason`:

```
if (props.reason === 'fullyBooked')
  return t('ride.fullyBookedTitle')
return props.reason === 'unavailable' ? t('ride.unavailableTitle') : t('ride.overlapTitle')
```

The description computed is the same three-way split (`fullyBookedBody` / `unavailableBody` / `overlapBody`). One reason-to-keys map would feed both.

**Judgement — Duplicated Code.** `e2e/fully-booked.spec.ts` `chooseMenu` opens the listbox and clicks the option, while that file already imports `chooseOption`. `e2e/transfers.spec.ts` already defines `chooseMenu` as `chooseOption(...)`.

`capacityDialogReason` wrapping `capacityConfirmReason` is required: `fullyBooked` must stay out of the confirmable union (ADR-0034). The per-command catch sites match the commands that ADR names.

## Spec

No findings.

**(a) Missing or partial.** None. Create and correct toast Popunjeno and the save still stands (`warnIfFullyBooked` on both responses). Duplicate and return use that same create save. The board mark is the Warning tier and only while the Ride is unassigned. Assign, vehicle change, reassignment, handoff, and partner change open the `fully_booked` dialog with the confirm button removed. The e2e covers the Croatian recording warning, correction, board filter, assign and handoff refusals, one English smoke, light and dark, and axe.

**(b) Scope creep.** None. Vehicle change, reassignment, and partner change are the other ADR-0034 refusals that already share this dialog.

**(c) Implemented but wrong.** None. `capacityConfirmReason` still returns null for `fully_booked`, so confirm is not offered and is not resent.
