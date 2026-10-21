# Worker mail loaders check no role

Status: accepted

## Context

AGENTS.md says every loader that returns tenant data enforces the role allow-list itself, and that there is no exception without an ADR.

The mail outbox worker calls `loadInvitationAttempt`, `invitationAttemptStore`, `loadOutboxAttempt`, `outboxAttemptStore`, `mailOutboxStore`, and `readInvitationForMail`. The worker has no actor, so those loaders cannot check a role. The HTTP resend route does not call them. `resendFailedMail` checks the role, then loads. Issue #344 asks for a structural guard rather than a role check inside the loaders. Damir accepted this on 21 October 2026.

## Decision

We will not add a role check to those loaders. The only list of them is `workerUsedLoaders` in `eslint/worker-used-loaders.mjs`.

A file under `server/api/` or `server/routes/` that is not a test may import or call one only when the function that uses it, or a function enclosing that use, calls `officeOnly` or `requireRole` imported from the tenancy module (`workerLoaderRoleModule` in that same file). The call has to precede the loader use. A local function, any same-named callee, and a call in a different function do not count. `transferpro/worker-loader-role` fails the file otherwise. Module code and tests stay outside the rule. The worker and `resendFailedMail` keep calling the loaders.

## Consequences

A future HTTP route can call a loader only from a handler that imports `officeOnly` or `requireRole` from the tenancy module and calls it before the use. RLS still limits the row to the tenant. The role limit for that call is the lint rule, not a check inside the loader. This ADR is the exception AGENTS.md requires.
