# Preview deploy

Coolify builds `Dockerfile` from `develop`. The image does not migrate on start. Apply migrations by hand with the owner URL before the new container takes traffic.

The process listens on `PORT` (default 3000) at `HOST` `0.0.0.0`. The container health check is `GET /api/ready`. That route returns 200 when the runtime roles can use the database, and 503 otherwise. It does not require a session.

Set these names in the preview environment. Values stay in Coolify.

| Name | Required |
| --- | --- |
| `DATABASE_URL` | Yes. `transferpro_app`. |
| `AUTH_DATABASE_URL` | Yes. `transferpro_auth`. |
| `QUEUE_DATABASE_URL` | Yes. `transferpro_queue`. |
| `PLATFORM_DATABASE_URL` | Yes. `transferpro_platform`. |
| `BETTER_AUTH_SECRET` | Yes. |
| `BETTER_AUTH_URL` | Yes. The preview origin. |
| `MAILER` | `console` on preview. |
| `ALLOW_CONSOLE_MAILER` | `1` together with `MAILER=console`. Any other value keeps the production Resend rule. |
| `RESEND_API_KEY` | Omit on preview. Required when `MAILER=resend`. |
| `LOG_LEVEL` | No. |
| `MAPS` | No. Default `none`. |
| `MAPS_API_KEY` | Only when `MAPS=google`. |
| `SENTRY_DSN` | No. |
| `SENTRY_RELEASE` | No. The deployed git SHA. |
| `HOST` | No. The image sets `0.0.0.0`. |
| `PORT` | No. The image sets `3000`. Coolify may override it. |

`DATABASE_MIGRATE_URL` is not an app variable. Do not put it on the container.

Production leaves `ALLOW_CONSOLE_MAILER` unset and sets `MAILER=resend` with `RESEND_API_KEY`.
