# Console mailer on preview

Status: accepted; partially superseded by ADR-0042

ADR-0042 amends "Preview sets both `ALLOW_CONSOLE_MAILER=1` and `MAILER=console`." Preview now sets `MAILER=resend`, `RESEND_API_KEY`, and `MAIL_ALLOWLIST`, and sends real mail only to the listed addresses. The flag stays valid for a deployment that wants console only. The rest of this decision stands.

## Context

ADR-0013 requires `MAILER=resend` and `RESEND_API_KEY` whenever `NODE_ENV` is `production`. The Coolify preview image is that process: it is built from `develop` and runs with `NODE_ENV=production`. Preview has no separate Node environment. Sending through Resend from preview would spend the one daily quota shared by every key on the account.

The alternatives were a second `NODE_ENV` value, which Nitro's production build does not treat as production, and leaving `MAILER` unset, which ADR-0013 already rejects in production.

## Decision

We will allow `MAILER=console` in production only when `ALLOW_CONSOLE_MAILER` is exactly `1`. The Resend key is then optional. Any other flag value, including unset, blank, and `0`, keeps the ADR-0013 rule: production boots only with `MAILER=resend` and `RESEND_API_KEY`. The flag does not change development or test. Preview sets both `ALLOW_CONSOLE_MAILER=1` and `MAILER=console`. Production leaves the flag unset.

## Consequences

A preview container can boot without a Resend key. A production deploy that sets the flag by mistake logs mail instead of sending it. The flag is not a mailer; `MAILER` still chooses the transport.
