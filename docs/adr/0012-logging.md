# Logging, redaction, and error responses

Status: accepted

## Context

The charter requires one JSON logger in `server/core`, a request id, `tenant_id` on lines inside a tenant call, and a redaction list so personal data never reaches a log line. Pino can write that JSON line, but its own path redaction stops at one level, so a nested passenger name would be written. Nitro's default error handler puts the stack in the response body in development and calls `console.error` in production, which skips the redaction list.

## Decision

We will log with Pino from one module, `server/core/logger.ts`, reached only through `server/core/index.ts`. Callers do not import Pino. The module does not call `console`: a console write skips redaction. `no-console` is off only in that file so the exception stays in one place. The error handler does not call `console.error`. Before a line is written, a key list is walked at any depth. Personal-data keys match exactly. A key is also redacted when its normalized name contains `secret`, `token`, `password`, `cookie`, `authorization`, `apikey`, or `databaseurl`. The key `detail` matches exactly, because Postgres puts row values there. `user_id` is kept.

`request_id` and `tenant_id` are read from async context at write time. A payload field of either name is dropped, so a call site cannot invent them. An incoming `x-request-id` is reused only when it matches `^\w[\w.-]{0,127}$`. Any other value is replaced with a new UUID, so a header cannot break the JSON line or carry personal data.

`server/error.ts` is the Nitro error handler. It logs the error once and responds with `{ statusCode, message, request_id }`. The message is a fixed phrase for that status. The handler does not return `error.message` or the stack, and it does not call Nitro's default handler.

Log message text and `Error.message` / `Error.stack` are not scanned. The redaction list sees field names.

## Consequences

A nested personal-data field is redacted. A value interpolated into the message text is not. `console` outside the logger is a lint error. A `console` call inside the logger would still skip the list, which is why that module does not use one. Error tracking (Sentry or GlitchTip) stays a separate charter item; this decision adds no SDK.

## Amendment (2026-10-05, #34)

The redaction list now lives in `shared/redact.ts` and is shared with Sentry `beforeSend` scrubbing. Logger behaviour is unchanged: it still imports that module and walks the same key list at write time.
