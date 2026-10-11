# 184 Ride occupation

Out of scope: pickup edits, the #183 silent alarm, and a check on clear.

## Decisions

- The occupied window opens at the pickup. It ends at the landing plus the transfer duration when a landing is stored, and otherwise at the pickup plus the transfer duration. A landing that finishes that sum at or before the pickup leaves an empty window. Do not move the start to the landing. ADR-0029.
- A true overlap is 409 `ride_overlap` and writes nothing. The body is `{ code }` only. `confirm: true` on assign, vehicle change, or reassign writes and sends the existing work order. A tight gap (`end + gap > next pickup`, and not an overlap) is `relocationWarnings` on the success payload. It is not a 409 and does not use `confirm`. A gap equal to the setting is neither.
- Occupying rows are `state in ('assigned', 'accepted')`, which includes in progress. Do not add a state. Done, no-show, cancelled, and unassigned do not occupy. The Ride being changed is excluded. Clear does not query the schedule.
- `transfer_duration_minutes` defaults to 60 and `relocation_gap_minutes` defaults to 15. Both are 1 through 1440. The audit actions sit at the end of the enum: `settings.transfer_duration_changed` and `settings.relocation_gap_changed`, with `{ from, to }` and no subject.
- The warning payload names the other Ride by id. The toast does not show that id. Do not put a guest name on it.
- After the review below, `server/api/rides.rls.test.ts` covers the 409 leaving the row unassigned, and that another Tenant’s assigned Ride is not visible in the app session.

## Code review

Reviewed uncommitted `feature/184-ride-overlap` against `origin/develop` (`git diff origin/develop`, untracked files included). No commits at review time.

## Standards

No hard breaches of AGENTS.md, working-rules, ADR-0018, ADR-0005, ADR-0022, or ADR-0029. Audit actions have the enum, the shape check, the migration, and both locales. New minutes stay on `tenant_settings` (existing RLS). Schedule math is in `shared/ride-schedule.ts` and does not import Drizzle. Clear does not call the check. Both locales and an e2e spec are present.

**Judgement — Duplicated Code.** The same overlap path is copied in `RideAssign.vue`, `RideReassign.vue`, and `RideVehicle.vue`:

```ts
...(confirm ? { confirm: true } : {}),
if (assigned.relocationWarnings.length > 0) {
 toast.add({ title: t('ride.tightGap'), color: 'warning' })
}
if (errorCode(error) === 'ride_overlap') {
 overlapOpen.value = true
 return
}
```

plus the same `<RideOverlapDialog>`. The dialog is shared; the request, 409 branch, and toast are not.

**Judgement — Duplicated Code.** `ScheduleClash` (`resource` + `rideId` in `shared/ride-schedule.ts`) and `relocationWarningSchema` in `shared/work-order.ts` are the same pair. The HTTP schema can stay; the enum should not be declared twice.

**Judgement — ADR-0029 Consequences** (“The warning names the other Ride by id”). `relocationWarnings` does carry `rideId`. The toast in all three forms is only `ride.tightGap` (“The gap before or after another ride is tight.”) and drops that id. Hard only if that sentence binds the office-facing text; the saved action itself complies.

**Not flagged.** Reusing `waitMinutesSchema` (1–1440) matches the ADR range; comments already say these are not No-show waits. Settings and audit edits are scattered because working-rules require that wiring. `e2e` importing `../shared/date` matches existing specs and is outside the import lint.

## Spec

### (a) Missing or partial

**RLS coverage of the new read is partial.** Unit tests cover the interval judge, a 409 that does not write, and `confirm: true` on assign, vehicle change, and reassign. `server/api/rides.rls.test.ts` only adds `relocationWarnings: []` to existing asserts. Nothing in RLS shows an overlap 409 leaving the row unchanged, or that another tenant’s Ride does not occupy. Original acceptance: “Unit/RLS tests; no real mail.” Mail stays on the existing fake/console path.

### (b) Scope creep

None. Tenant columns (defaults 60 and 15), the settings form, audit actions, and ADR-0029 are the storage the grill’s tenant fields require. Clear still does not judge; `relocationWarnings: []` is only so the shared response parses. Pickup edits are untouched.

### (c) Implemented but wrong

**The occupied interval does not follow the end formula once `landing_at` is set.** Spec: “Occupied window end = landing_at + transferDurationMinutes when landing_at is set; otherwise pickup_at + transferDurationMinutes. … Do not invent a second duration field.”

`occupiedEnd` matches that end, but `intervalsOverlap` always opens the window at `pickup_at`. A later landing therefore occupies pickup-to-landing plus the transfer duration, longer than `transferDurationMinutes`. If `landing_at + duration` is at or before pickup, the window is treated as empty and the Ride occupies nothing, so a true overlap is not a 409.

The rest of the grill matches the diff: tight gap (`end + gap > next pickup`, equal gap neither) is a success warning with no 409 and no confirm; assigned and accepted occupy, including in-progress via that SQL set; the Ride being changed is excluded; the first overlap returns 409 `ride_overlap` before the update, and `confirm: true` then writes and uses the existing work-order send.
