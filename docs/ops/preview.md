# Preview deploy

Coolify builds `Dockerfile` from `develop`. The image does not migrate on start. Apply migrations by hand with the owner URL before the new container takes traffic.

The process listens on `PORT` at `HOST`. The image sets both. Coolify may set `PORT`. The container health check is `GET /api/ready`. That route returns 200 when the runtime roles can use the database, and 503 otherwise. It does not require a session.

Set these names in the preview environment. Values stay in Coolify.

| Name | Required |
| --- | --- |
| `DATABASE_URL` | Yes |
| `AUTH_DATABASE_URL` | Yes |
| `QUEUE_DATABASE_URL` | Yes |
| `PLATFORM_DATABASE_URL` | Yes |
| `BETTER_AUTH_SECRET` | Yes |
| `BETTER_AUTH_URL` | Yes |
| `MAILER` | Yes |
| `ALLOW_CONSOLE_MAILER` | Yes on preview |
| `RESEND_API_KEY` | Only when `MAILER` is `resend` |
| `LOG_LEVEL` | No |
| `MAPS` | No |
| `MAPS_API_KEY` | Only when `MAPS` is `google` |
| `SENTRY_DSN` | No |
| `SENTRY_RELEASE` | No |
| `HOST` | No |
| `PORT` | No |

`DATABASE_MIGRATE_URL` is not an app variable. Do not put it on the container.

Preview sets `MAILER` to `console` and `ALLOW_CONSOLE_MAILER` to `1` (ADR-0037). Production leaves `ALLOW_CONSOLE_MAILER` unset and sets `MAILER` to `resend` with `RESEND_API_KEY`.
