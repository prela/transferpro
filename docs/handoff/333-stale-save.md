# 333 Stale save

Out of scope: the who-and-when screen, and a version on the Client.

## Decisions

- One version on the Transfer covers the Transfer and its Ride. `data_changed_by` is the member id as text, with no foreign key.
- A fresh correction that changes nothing writes nothing and does not bump the version. A stale no-op is 409 `stale_save` and writes nothing.
- An overlap refusal does not bump. Confirm resends the same version.
- A mismatch is checked before the closed-Ride rule. After the review below, a correction calls `refuseStaleVersion` before the closed check. A wrong version on a finished Transfer is `stale_save`. The current version on a finished Transfer is `transfer_closed`.
- Driver accept, decline, done, and no-show, office cancel, accept by phone, and early no-show, a landing time, and a live flight fact do not bump. A following office save that is still legal passes with the same version. A finished or unassigned Ride is refused by the existing state check.
- The day read returns `version`, `changedAt`, and `changedByName`. It does not return the user id. A former member and another tenant's author are a null name.
- The author join also requires `changed_by.tenant_id = t.tenant_id`. `app.tenant_member` exposes that id (migration `0044`). The view already filters by the session tenant.
- A 409 stays the generic save error. `rideFormStamp` includes the version, so a client-reference-only save still shows the existing change hint.
- Tests fill the stored version when the body omits it. An explicit version is left alone.
- ADR-0039 keeps its accepted sentence. Only its status line names this partial supersession. ADR-0046 records the acceptance in #333.
- The merge of `origin/develop` keeps the ride CSV export (`RideExportRangeError`, `exportRides`) beside `StaleSaveError`.

## Code review

Reviewed `feature/333-stale-save` against `origin/develop` before the follow-ups in Decisions. The Standards and Spec reports below are verbatim.

## Standards

No hard breaches of `AGENTS.md`, `docs/agents/working-rules.md`, ADR-0018, ADR-0012, or `GLOSSARY.md`.

Checked and aligned: the opened version is Zod at the HTTP boundary (`z.number().int().nonnegative()`). `StaleSaveError` leaves through `server/modules/transfers/index.ts` and is mapped like other 409s (`statusCode` plus `data.code`, no `error.message`, no name). That is ADR-0012’s fixed phrase, plus the code ADR-0046 and the existing `ride_overlap` path already require. The day-list name is read from `app.tenant_member`, not stored in an audit entry or a log line. Journal `when` for `0043` is the previous entry plus 1000. `data_changed_at` is `timestamptz`. No new audit action. The glossary term **Stale save** uses Transfer, Ride, Client, and Driver. ADR-0018 is untouched. `changedAt: z.unknown()` matches the existing `landingAt` conversion. The missing newline on `_journal.json` is an end-of-file lint rule; skipped.

### Judgement calls

**Duplicated Code.** `server/api/rides.rls.test.ts` and `server/api/transfers.rls.test.ts` each add the same “fill the opened version” helpers. The ride lookup is the same statement:

```sql
select t.version
from app.transfers as t
join app.rides as r on r.transfer_id = t.id and r.tenant_id = t.tenant_id
where r.id = $1
```

`bodyWithOpenedVersion` and the `assignRide` wrapper that injects the stored version when the key is absent are the same shape in both files. One shared test helper would serve both.

**Duplicated Code.** `correct.ts` repeats the mismatch check instead of `refuseStaleVersion`:

```ts
if (current.version !== version)
  throw new StaleSaveError()
```

The booking update also repeats the claim columns (`version = version + 1`, `data_changed_at = now()`, `data_changed_by`, `and version = ${version}`). ADR-0046 wants that predicate on the write itself, so a second call to `claimTransferVersion` would be the wrong extract. The early `if` can still call `refuseStaleVersion`.

Primitive Obsession on `version: number` is suppressed: ADR-0046 defines one integer column. Threading that field through forms, HTTP, and e2e is the required body, not Shotgun Surgery.

## Spec

### (a) Missing or partial

**The office save after a finished Ride does not pass.** "Each Driver state action, a landing time, and a live-status write leave the version alone, and the office save after them passes." Accept and decline do: the version stays, and the next vehicle change or assign returns 200. After the Driver's done and no-show, the version stays, but the office vehicle change is 409 `ride_not_open`. Cancel and early no-show are the same: version unchanged, save refused by the existing state check. #326 story 8 asks for that on office state actions; the "passes" line is still unmet for done and no-show.

### (b) Not asked for

**The change warning now treats a version bump as a change.** #326: "The existing \"Vožnja je promijenjena\" warning stays as the early hint." `rideFormStamp` now includes `version`. A correction that changes only the client reference (not otherwise in that stamp) sets the warning. This ticket only asked the forms to send the opened version and to keep the generic 409.

### (c) Implemented, but wrong

**A stale correction of a closed Transfer is not `stale_save`.** "A mismatch is 409 `stale_save` … even when the body would change nothing, and writes nothing." `correctTransferForOffice` throws `transfer_closed` before it compares versions. A done Ride with `version: 99` returns `transfer_closed` and not `stale_save`. Assign, reassign, vehicle change, and clear compare the version first, so the same mismatch is `stale_save`. Nothing is written either way.
