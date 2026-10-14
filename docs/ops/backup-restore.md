# Backup and restore

Preview Postgres is 18. A daily job dumps it, encrypts the dump, and uploads the ciphertext to Cloudflare R2. A restore goes into a different database. It never opens the preview database as the restore target.

The app container does not run this. `DATABASE_MIGRATE_URL` stays off that container (`docs/ops/preview.md`). The job is a checkout of the repo with PostgreSQL 18 client tools, GnuPG, and Node.js 22 or newer.

## Environment

Values live in a mode `0600` file outside the repo. Names:

| Name | Purpose |
| --- | --- |
| `BACKUP_DATABASE_URL` | Superuser URL of the database to dump. The app role would hide tenant rows. |
| `BACKUP_GPG_PASSPHRASE` | Symmetric passphrase. Never committed, never passed as an argument. |
| `BACKUP_S3_BUCKET` | R2 bucket name. |
| `BACKUP_S3_ENDPOINT` | R2 S3 origin only, `https://<accountid>.r2.cloudflarestorage.com`. |
| `BACKUP_S3_REGION` | `auto` for R2. |
| `BACKUP_S3_PREFIX` | Object prefix. Default `daily`. |
| `AWS_ACCESS_KEY_ID` | R2 access key id. |
| `AWS_SECRET_ACCESS_KEY` | R2 secret. |
| `RESTORE_DATABASE_URL` | Superuser URL of the empty target database. |
| `RESTORE_APP_DATABASE_URL` | `transferpro_app` URL of that same target database. |
| `BACKUP_OBJECT_KEY` | Optional. Default is the newest daily object. |

`BACKUP_S3_ALLOW_HTTP` and `BACKUP_PG_DOCKER_IMAGE` are for the disposable test. Leave them unset on the scheduled task.

## Retention

Daily objects are kept for 14 days. There is no weekly tier. The backup script deletes older `daily/<timestamp>.dump.gpg` objects after each upload. The timestamp is UTC `YYYYMMDDTHHMMSSZ`.

## Schedule

Once a day, from the repo checkout:

```sh
set -a
. /etc/transferpro/backup.env
set +a
./scripts/backup-database.sh
```

Coolify can run that as a scheduled task in an image that has the client tools, GnuPG, and Node. Cron on the host is the same command. The success line is `backup_key=daily/...dump.gpg`.

## Restore

1. Create an empty database on Postgres 18. Use another instance when the dump came from preview, so a mistake cannot reach the preview data directory. On the preview host the database name must differ: the script refuses the source host and database name, including `localhost` and `127.0.0.1`. A database dump does not contain roles. The target cluster needs `transferpro_owner`, `transferpro_app`, `transferpro_auth`, `transferpro_queue`, and `transferpro_platform` before `pg_restore`. `docker/postgres/init-roles.sh` creates them. Passwords belong to that cluster.
2. Put the superuser URL of that empty database in `RESTORE_DATABASE_URL` and the `transferpro_app` URL in `RESTORE_APP_DATABASE_URL`.
3. Keep `BACKUP_DATABASE_URL` pointed at the database the dump was taken from. The script uses it only to refuse restoring over that database. `pg_restore` is not given `--clean` or `--create`.
4. Run `./scripts/restore-database.sh`. Set `BACKUP_OBJECT_KEY` to restore a specific object.

The script downloads, decrypts, restores, then checks. `restore_seconds` starts at the download. A fresh database's `public` schema is dropped so the dump can create it. The isolation check inserts two `app.tenant_settings` rows and deletes them before it exits.

- `drizzle.__drizzle_migrations` has the same count as `db/migrations/meta/_journal.json`
- the roles `transferpro_owner`, `transferpro_app`, `transferpro_auth`, `transferpro_queue`, and `transferpro_platform` exist
- the app URL connects as `transferpro_app`
- one Tenant cannot read or change the other's `app.tenant_settings` row

It prints `restore_seconds=<n>`. A failed check leaves the isolated database in place and does not point the app at it.

## Measured duration

A disposable Postgres 18 restore on this repo, through the script, took 6 seconds (`restore_seconds=6`). That run used a local stand-in for R2, so it does not include the preview network. The owner records the R2 restore duration here after that restore.
