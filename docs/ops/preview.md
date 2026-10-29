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
| `MAPS_EMBED_KEY` | No. Optional with either `MAPS` value. Restrict the key to the Maps Embed API and this environment's origin. |
| `INVOICING` | No. `none` or `current`. Default `none`, so the process does not call the current tool. |
| `INVOICING_SECRET_KEY` | When `INVOICING` is not `none`. 32 bytes, base64. Env only. |
| `SENTRY_DSN` | No |
| `SENTRY_RELEASE` | No |
| `HOST` | No |
| `PORT` | No |

`DATABASE_MIGRATE_URL` is not an app variable. Do not put it on the container.

Every name in the table is runtime only. In Coolify, leave "Available at Buildtime" off. The Dockerfile declares no secret `ARG` or `ENV`. `docker build` must not warn `SecretsUsedInArgOrEnv`.

`nuxi build` does not read `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_DATABASE_URL`, `MAPS_API_KEY`, `MAPS_EMBED_KEY`, or `INVOICING_SECRET_KEY`. Boot reads them from the process environment (`parseAppEnv`). Nitro's production build replaces the token `process.env.NODE_ENV` only, not those names. `.dockerignore` excludes `.env`, so a local file is not copied into the build. The server bundle still contains the key strings, because that is how it reads `process.env` at start. The client bundle (`.output/public`) must not. No value is required at build time, so the image does not use a BuildKit secret mount.

`NODE_ENV=production` is set on the runtime stage. It is not a build `ARG` and it is not a secret. `nuxi build` emits a production server without that variable. Do not pass it as a build-arg.

`SENTRY_DSN` is also runtime for the server SDK. `nuxt.config.ts` reads it while the config loads, and a value present then is copied into the client runtime config. Leave it off the build as well.

After a build, this fails if a secret name was declared, if `docker history` records a name or a supplied value, or if a supplied value (or a secret name in the client bundle) is in `.output`. Findings do not print values.

```sh
node scripts/assert-image-secrets.mjs --image <image> --values-file <sentinels.txt>
```

`<sentinels.txt>` is one value per line, at least 8 characters, and is not committed. Omit `--values-file` to check names only.

Preview sets `DEPLOY_ENV` to `preview` (ADR-0043), and `MAILER` to `resend`, `RESEND_API_KEY`, and `MAIL_ALLOWLIST` (ADR-0042). Boot refuses to start when `DEPLOY_ENV` is `preview` and `MAIL_ALLOWLIST` is unset. Only addresses on that list are sent; every other recipient is the console line. `NODE_ENV` stays `production` on preview and on production. Production leaves `DEPLOY_ENV` unset or sets `production`, leaves `MAIL_ALLOWLIST` unset, and sets `MAILER` to `resend` with `RESEND_API_KEY`. A deployment that wants console only sets `ALLOW_CONSOLE_MAILER` to `1` and `MAILER` to `console` (ADR-0037).

## Demo seed

The image has no `scripts/` and does not run the seed. Run it from a local checkout of `develop`, the same way as migrations.

Create a local `.env.seed` and do not commit it. It holds the preview `AUTH_DATABASE_URL` and `DATABASE_MIGRATE_URL`, `DEPLOY_ENV=preview`, `MAILER=console`, an empty `RESEND_API_KEY`, and `DEMO_SEED=1`. `DEMO_SEED_PASSWORD` is optional.

Apply migrations to the preview database first, then run:

```sh
pnpm db:seed:demo
```

That command loads `.env`, then `.env.migrate`, then `.env.seed` when the file exists. A later file overrides an earlier one, so the preview URLs and `MAILER=console` replace the local ones. A name already set in the shell wins over the files. A second run replaces the `demo` Tenant and touches nothing else.

Keep `DEMO_SEED_PASSWORD` only in a password manager. If you leave it unset, the command prints a generated password once. Save it. It must never go into the repo, `.env.example`, an issue, or a pull request.

Verify by signing in on preview as `demo-dispatcher@example.com`, opening the office day list (rides are there and the map shows for the airport and the hotel), then signing in as `demo-driver-a@example.com` at 360px and checking the long ride.
