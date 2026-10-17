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
| `RESEND_API_KEY` | Yes on preview |
| `DEPLOY_ENV` | Yes. Set to `preview` |
| `MAIL_ALLOWLIST` | Yes on preview |
| `ALLOW_CONSOLE_MAILER` | Only for a console-only deployment |
| `LOG_LEVEL` | No |
| `MAPS` | No |
| `MAPS_API_KEY` | Only when `MAPS` is `google` |
| `SENTRY_DSN` | No |
| `SENTRY_RELEASE` | No |
| `HOST` | No |
| `PORT` | No |

`DATABASE_MIGRATE_URL` is not an app variable. Do not put it on the container.

Preview sets `DEPLOY_ENV` to `preview` (proposed ADR-0043), and `MAILER` to `resend`, `RESEND_API_KEY`, and `MAIL_ALLOWLIST` (ADR-0042). Boot refuses to start when `DEPLOY_ENV` is `preview` and `MAIL_ALLOWLIST` is unset. Only addresses on that list are sent; every other recipient is the console line. `NODE_ENV` stays `production` on preview and on production. Production leaves `DEPLOY_ENV` unset or sets `production`, leaves `MAIL_ALLOWLIST` unset, and sets `MAILER` to `resend` with `RESEND_API_KEY`. A deployment that wants console only sets `ALLOW_CONSOLE_MAILER` to `1` and `MAILER` to `console` (ADR-0037).
