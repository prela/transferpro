Out of scope: production backups, R2 bucket and key setup, and the owner's real restore from R2.

## Decisions

- Retention is 14 daily objects and no weekly tier (`DAILY_RETENTION_DAYS` in `scripts/s3-object.mjs`). That is the owner comment on #234.
- Encryption is GnuPG symmetric. The passphrase is `BACKUP_GPG_PASSPHRASE`. It stays off the process arguments.
- `assertIsolatedRestore` refuses the same host and database name. `localhost` and `127.0.0.1` are one host. A different database name on that host is allowed; the disposable test restores that way. The preview restore should use another instance.
- A database dump does not contain roles. The target cluster needs the five roles before `pg_restore`.
- Do not pass `--clean` or `--create` to `pg_restore`.
- `restore_seconds` starts at the download and includes decrypt, restore, and the checks.
- `BACKUP_S3_ALLOW_HTTP` and `BACKUP_PG_DOCKER_IMAGE` are for the disposable test. The scheduled task leaves them unset.
- The backup job is not the app container. The work directory is `.backup-work/` because Docker Desktop cannot mount `/tmp`.
- Database URLs are parsed with Zod in `scripts/backup-target.mjs`. The standards review below called out hand-rolled checks; that parse was added after the review.

## Code review

## Standards

### Documented standards

**Hard.** `scripts/backup-target.mjs` (`databaseIdentity`, `writeConnectionFiles`) validates `BACKUP_DATABASE_URL` and the restore URLs with hand-rolled checks. `AGENTS.md` (Security): “Zod at every runtime boundary (env, request bodies, query params, imported bookings).” Shell `require_var` only tests non-empty. The same change does use Zod for the S3 env in `scripts/s3-object.mjs` (`loadBackupS3Env`).

**Judgement.** `docs/agents/working-rules.md` refuses `--password` because the value lands on the command line. `scripts/backup-restore.test.mjs` still puts secrets in `docker run` argv (`PGPASSWORD=postgres`, `TRANSFERPRO_*_PASSWORD=...`). The backup scripts themselves keep the passphrase off argv (`--passphrase-fd`).

No breach of ADR-0011 (restore proof checks behaviour via `set_config`, not policy text; five roles match owner/app/auth/queue plus `transferpro_platform` in ADR-0019), ADR-0012 (errors omit the URL, password, and S3 body), or ADR-0004 (`pg_dump -Fc` has no schema filter, so `pgboss` stays in the dump).

### Baseline smells (judgement)

**Duplicated code.** The same `isCli` plus stderr/exit harness is copied in `scripts/backup-target.mjs` and `scripts/s3-object.mjs`. The same `run()` spawn helper is copied in `scripts/backup-target.test.mjs` and `scripts/backup-restore.test.mjs`. GnuPG home setup is repeated:

```17:20:scripts/backup-database.sh
export GNUPGHOME=$PG_WORK_DIR/gnupg
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
```

```32:34:scripts/restore-database.sh
export GNUPGHOME=$PG_WORK_DIR/gnupg
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"
```

The fixture tenant ids and the `delete from app.tenant_settings` cleanup appear in both `scripts/restore-database.sh` and `scripts/verify-restored-database.sh`.

## Spec

The slice covers the issue: `pg_dump -Fc`, GnuPG with `BACKUP_GPG_PASSPHRASE`, an S3 upload, 14-day daily retention and no weekly tier, a restore into another database, the four checks, `docs/ops/backup-restore.md` (steps, env names, Coolify or cron), and a disposable Postgres 18 test on the slow CI job. No hard miss. Three judgement calls:

**(a)** “Runbook `docs/ops/backup-restore.md`: … and the measured restore duration.” The runbook’s `restore_seconds=5` is a local stand-in, and the clock in `restore-database.sh` starts after download and decrypt, immediately before `pg_restore`. Transfer time is not in that number. Leaving the R2 figure for the owner matches “The owner then runs one real restore from R2 (HITL) and confirms.”

**(b)** The restore does more than “download, decrypt, `pg_restore`.” It drops `public` on the target, inserts two `app.tenant_settings` rows, then deletes them. The inserts are how “RLS isolates tenants” is checked; the drop and the delete are extra writes on every restore, including the owner’s R2 run.

**(c)** “`pg_restore` into a separate, isolated database (never the preview DB).” `assertIsolatedRestore` refuses only the same host and same database name (`localhost` and `127.0.0.1` count as one host). A second database on the preview host is allowed, and the disposable test restores that way. A second hostname for the preview server is not treated as the preview database.
