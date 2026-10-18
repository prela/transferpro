# Refuse a stale save

Status: accepted

Recorded with #333, from spec #326. It partially supersedes one consequence of ADR-0039, named below. ADR-0029 still refuses a true overlap with 409 `ride_overlap` and still writes nothing when a fresh save changes nothing.

## Context

Two office members can edit the same Transfer or its Ride at once. The server took the last save and wrote over the earlier one. ADR-0039 shows "Vožnja je promijenjena" in the browser after a refresh, and left refusing that save as a write-path decision. A Dispatcher could assign a Driver from a pickup a colleague had already moved.

The alternatives were merging field by field, a live lock, and a version on every catalog row. #206 left a server version check for step 13, together with concurrent capacity writes.

## Decision

We will refuse an office save made from data that someone has changed since the form was opened. Nothing is merged.

One version covers a Transfer and its Ride. It lives on the Transfer row, with the time of the last data change and the member user id who made it. The name is read through `app.tenant_member`, as the audit log reads a name. A member who has left has no row there, so the name is null. A Client will have its own version; this record does not add it.

Only an office data save changes the version: a Transfer correction, and the Ride's Driver and Vehicle through assign, reassign, a Vehicle change, and clear. These do not: the Driver's accept, decline, done, and no-show; the office's cancel, accept by phone, and early no-show; a landing time from anyone; the live flight status writing an expected arrival or a landing time. Decline clears the Driver and the Vehicle without changing the version. An office save that then targets an unassigned Ride is refused by the existing state checks.

Those commands take the version the form was opened with. The body requires it. A missing version is 400. The check is `update ... where version =` the opened version, on the same transaction as the write, so two saves with one version cannot both pass. A mismatch is 409 `stale_save` with the ADR-0012 shape: a fixed message and the code, and no name. It is refused even when the body would change nothing, and before the closed-Ride rule, so an old form is `stale_save` even when the Ride has since been finished. A form that still holds the current version and finds the Ride finished is the existing `transfer_closed`. Nothing is written and no audit entry is appended. A match bumps the version and records the time and the member.

The ADR-0029 overlap confirmation sends that same version again. The overlap wrote nothing, so the version is unchanged, and the confirmation passes when nothing else changed.

The Transfer day read returns the version, the time, and the display name. The Ride detail is that same row. The 409 body does not carry them. After a refusal the screen can read them again. Until the screen that shows who and when, a 409 `stale_save` uses the generic save error. Audit entries and work orders stay as they are.

#206 step 13 keeps only concurrent capacity writes. This record is the server version check.

## Consequences

A Dispatcher cannot overwrite a colleague's correction or decide a Driver from an old pickup. Two saves at the same instant cannot both pass. A Driver's phone never makes an office save stale, and neither does a flight fact.

A row that has not changed since this column arrived has version 0 and no author. The refusal still works. The message that names the author is a later screen.

Accepting this ADR updates ADR-0039's status line to name this partial supersession.

### Superseded

ADR-0039's consequence "A save sent after it still writes over the other change, because the server does not refuse a stale save today." The server now refuses that save.
