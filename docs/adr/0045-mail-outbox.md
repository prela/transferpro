# Mail outbox with retries

Status: accepted

Damir accepted this on 18 October 2026, in the grill recorded on #206 as "Owner decisions 18.10." and in spec #325. It partially supersedes ADR-0026 and ADR-0013, and it amends ADR-0039. The sentences are named below.

## Context

A work order or an invitation that fails to send is lost. ADR-0026 says the work-order send is not retried, and the office sees "send failed" once, on the action that saved the Ride. ADR-0013 creates the invitation and returns the copyable link, and tells the admin the email was not sent, with no further attempt. If nobody notices, the Driver never hears about a change, and an invitee never gets the link. A short provider outage or a hit on the shared daily Resend quota turns into a forgotten message. The office has no place to see what did not go out or to send it again.

The alternatives were leaving the send direct, retrying inside the same request until it worked, and waiting for the event outbox of #206 steps 14 and 17 to carry mail. That later outbox is a different log. Password reset and "Lozinka je promijenjena" belong to an account, not a Tenant (ADR-0042), so they are not this table.

Resend keeps an idempotency key for 24 hours (checked 18 October 2026, Idempotency Keys). Within that window the same key and payload return the original response without sending again. The same key with a different payload returns `409 invalid_idempotent_request`. A request while another with the same key is in flight returns `409 concurrent_idempotent_requests`. After 24 hours the key is forgotten and a request sends again. A duplicate can only happen when an earlier attempt that we recorded as failed was in fact delivered. That risk is accepted.

## Decision

We will send every work order and every invitation through a mail outbox. The first send still happens right after the save, and the action still waits for it. When it fails, the system tries again after 1, 5, and 30 minutes. After that the entry is failed. Before every attempt the system checks whether the mail still matters. If it does not, nothing is sent and the entry is stale. The office home shows a "Neuspjeli mailovi (n)" block listing the failed mails that still matter, each with "Pošalji ponovno". Entries are kept for 90 days and then deleted.

This is a mail outbox. It is separate from the event log and outbox of #206 steps 14 and 17. That later event log may write into this outbox. It does not replace it. Step 14 no longer decides whether ADR-0026's "no retry" is superseded: this record does. Password reset and password changed stay outside (ADR-0042). Live-flight notices join when their wording ships. Until then they stay as they are.

The table is a tenant table with `tenant_id`, FORCE ROW LEVEL SECURITY, a `tenant_isolation` policy with `USING` and `WITH CHECK`, and `REVOKE ALL FROM PUBLIC`. It stores the kind, the ids (a Ride id, a Driver id, the work-order status, and for "no longer yours" the released Vehicle id, or an invitation id), the state (`pending`, `sent`, `failed`, `stale`), the attempt count, the next attempt time, and the created time. `vehicle_id` is nullable. Only a work order may set it. An invitation leaves it null. It stores no address, no name, no subject, and no body. The full set of states and the attempt fields land in the first migration, so later slices add no columns. A Driver with a blank email at enqueue gets no entry, and the action shows "no email". A blank address found at a later attempt counts as a failed attempt.

The entry is written in the same transaction as the Ride change or the invitation. After commit, the action makes the first attempt and waits for it. The same transaction enqueues a pg-boss job for one minute later, so a process that dies between commit and the first attempt is picked up. On failure the next attempts follow after 5 and 30 minutes: at most 4 sends, and `failed` about 36 minutes after the save. Later attempts compose the mail from the current rows (Driver email, Ride, Tenant locale and time zone), so the content is never stored and never stale. A "no longer yours" retry reads the released Vehicle from `vehicle_id` on the entry, because the Ride no longer stores it. The first attempt, in the ticket that only records the work order, composes from the snapshot read on the Ride transaction. A re-read after commit no longer holds the vehicle a "no longer yours" mail must name. The idempotency key is the entry id plus a hash of the composed message. Only the Resend adapter sends the key. The console and fake mailers ignore it. `409 concurrent_idempotent_requests` is a transient failure. "Pošalji ponovno" is one immediate attempt with the same current-ness check. It does not start a new cycle. On failure the entry stays `failed`.

Damir, 18.10.: a work order is stale when the Ride is finished (`done` or `no-show`), or when a newer work order for the same Ride and the same Driver was recorded after this entry. A later assign, reassign, or vehicle change replaces only that Driver's earlier unsent mail. A mail to another Driver does not. Pickup time is not a criterion. A cancelled Ride stales assigned and changed mail. It does not stale "no longer yours": that Driver is still told they lost the Ride. It does not stale the cancellation notice either. A newer mail for that same Driver still does. Entries written in one transaction share `created_at` and do not replace each other, so a reassign still sends both the new assignment and "no longer yours". An invitation is current while it is pending. An attempt on a mail that is no longer current sends nothing and sets `stale`.

The office sees one result per Driver: sent, no email, "nije poslano, pokušat ćemo ponovno", or "nije poslan jer više nije aktualan". The result names the Driver, not the address. An invitation still returns the copyable link. A failed first attempt says "mail nije poslan, pokušat ćemo ponovno". A first attempt that is no longer current says it was not sent because it is no longer current. That result is `stale`, not `failed`.

"Neuspjeli mailovi (n)" sits below Pozornost. It is in neither the Urgent nor the Warning tier and does not count toward the urgent count. It lists `failed` entries that are still current, derived on read. Nothing is written on read. The recipient is derived when the list is shown: the Driver's name for a work order, the invitee's email for an invitation. A Dispatcher sees work orders only. An Admin sees work orders and invitations. The route enforces the allow-list itself. The block is part of the one office home read (ADR-0024) and refreshes with Home every 60 seconds. The failed rows are found through a partial index on `tenant_id` where the state is `failed`. A resend appends no audit entry. It writes one log line with the entry id, the kind, and the outcome. Logs never carry an address, a subject, a guest, a place, or a link.

A scheduled job deletes entries older than 90 days, whatever their state. This record is the ADR that allows that `DELETE` grant. The grant is limited to this table.

The first ticket records the work order and makes the first attempt. Retries, the current-ness check, the idempotency key, the Home block, invitations, and the retention delete follow. The table already has the columns they need.

## Consequences

A short outage no longer drops a work order or an invitation. The office still hears, on the action, whether the first attempt went out. Until the retry ticket is merged, a failed first attempt stays `pending` and is not tried again, so that ticket has to merge before the next release from `develop`.

The accepted duplicate is a mail we marked failed that Resend had already delivered, then a resend after the 24-hour window. Retries spend the same shared daily quota as every other mail. Preview allowlist and the test fake mailer still decide delivery. Tenant isolation is the row policy. The invitation id, when a later ticket stores it, stays a bearer secret and is not returned or logged.

### Superseded

ADR-0026: "The send is not retried." and the outcome "send failed", now "not sent yet, will retry". "The action waits for the attempt" stays for the first attempt.

ADR-0013: "A failed send still creates the invitation, returns the copyable link, and tells the admin the email was not sent." The invitation is still created and the link is still returned, and the send is retried.

ADR-0039: "Everything the office is asked to look at is in one of two tiers." The failed-mail block is outside both.
