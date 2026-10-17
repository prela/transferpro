# Preview is `DEPLOY_ENV`, not a second `NODE_ENV`

Status: accepted

## Context

ADR-0042 sends preview mail through Resend only to addresses on `MAIL_ALLOWLIST`. ADR-0037 already records that the Coolify preview image runs with `NODE_ENV=production`, the same as production. A second `NODE_ENV` was rejected there, because Nitro's production build does not treat another value as production.

The app therefore could not require the list on preview alone. A preview container with the list unset booted and could spend the shared Resend quota. The only protection was `docs/ops/preview.md`.

## Decision

We will parse `DEPLOY_ENV` with Zod at boot. The values are `preview`, `production`, or unset. A blank value is unset. Any other value fails boot, and the message does not include the value.

When `DEPLOY_ENV` is `preview`, boot requires `MAIL_ALLOWLIST`. When it is unset or `production`, the list stays optional. `NODE_ENV` stays `production` for both preview and production. The ADR-0037 console flag is unchanged: `ALLOW_CONSOLE_MAILER=1` together with `MAILER=console` still boots without the list.

This amends the preview-mail paragraph of ADR-0042 by adding that boot requirement. It does not change who receives mail once the process is up.

## Consequences

A preview container cannot start until the allowlist is set. Production is unchanged if `DEPLOY_ENV` is left unset. Coolify sets `DEPLOY_ENV=preview` next to `MAIL_ALLOWLIST`. The parsed value is on `AppEnv`; today only boot reads it.
