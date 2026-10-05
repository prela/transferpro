# Error tracking

Transferpro sends unhandled server and client errors to an error tracker through the [Sentry SDK](https://docs.sentry.io/platforms/javascript/guides/nuxt/) (`@sentry/nuxt`). The SDK is [GlitchTip-compatible](https://glitchtip.com/documentation/install): only the DSN changes between SaaS Sentry and a self-hosted GlitchTip instance.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `SENTRY_DSN` | No | When unset, the SDK is not initialised and the app reports nothing. |
| `SENTRY_RELEASE` | No | Git SHA or release name shown in the tracker (set in deployment). |

Set both in the deployment environment. Local development and CI omit `SENTRY_DSN` unless you are verifying the integration.

### Self-hosted GlitchTip

1. Create a project in GlitchTip and copy its DSN.
2. Set `SENTRY_DSN` to that value. No code or package changes are required.
3. Set `SENTRY_RELEASE` to the deployed git SHA so regressions map to a commit.

## Privacy

Events follow the same redaction rules as structured logs (#33). `sendDefaultPii` is off; session replay is not enabled. Request bodies and cookies are not attached to events.

Each event carries `request_id`, `tenant_id` (when known), `environment`, and `release`.

## Manual verification

In development with `SENTRY_DSN` set, `GET /api/dev/sentry-test` throws a deliberate error. That route is unavailable in production. Confirm the event appears in your Sentry or GlitchTip project.
