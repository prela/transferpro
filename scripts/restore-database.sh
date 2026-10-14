#!/usr/bin/env bash
# Download one encrypted dump and restore it into an empty database that is
# not the source. Then check migrations, roles, the app login, and tenant
# isolation. Does not pass --clean or --create: those can touch the source
# database when it shares the cluster.

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/backup-common.sh"

require_var BACKUP_DATABASE_URL
require_var RESTORE_DATABASE_URL
require_var RESTORE_APP_DATABASE_URL
require_var BACKUP_GPG_PASSPHRASE
require_var BACKUP_S3_BUCKET
require_var BACKUP_S3_ENDPOINT
require_var AWS_ACCESS_KEY_ID
require_var AWS_SECRET_ACCESS_KEY

node "$ROOT/scripts/backup-target.mjs" check "$BACKUP_DATABASE_URL" "$RESTORE_DATABASE_URL"

make_work_dir
cleanup() {
  if [[ "${RESTORED:-}" == 1 ]]; then
    prepare_connection "$RESTORE_DATABASE_URL"
    psql_value -c "delete from app.tenant_settings where tenant_id in ('00000000-0000-4000-8000-000000000234', '00000000-0000-4000-8000-000000000235')" >/dev/null || true
  fi
  rm -rf "$PG_WORK_DIR"
}
trap cleanup EXIT

export GNUPGHOME=$PG_WORK_DIR/gnupg
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"

started=$(date +%s)
if [[ -n "${BACKUP_OBJECT_KEY:-}" ]]; then
  key=$BACKUP_OBJECT_KEY
else
  key=$(node "$ROOT/scripts/s3-object.mjs" latest)
fi

node "$ROOT/scripts/s3-object.mjs" get "$key" "$PG_WORK_DIR/dump.gpg"
gpg --batch --yes --pinentry-mode loopback --decrypt --passphrase-fd 3 \
  --output "$PG_WORK_DIR/dump.custom" "$PG_WORK_DIR/dump.gpg" \
  3<<<"$BACKUP_GPG_PASSPHRASE"
rm -f "$PG_WORK_DIR/dump.gpg"

prepare_connection "$RESTORE_DATABASE_URL"
present=$(psql_value -c "select schema_name from information_schema.schemata where schema_name in ('app', 'drizzle', 'auth', 'pgboss', 'platform')")
if [[ -n "$present" ]]; then
  printf 'restore target is not an empty database\n' >&2
  exit 1
fi

# A fresh database already has schema public. The dump creates it again.
psql_value -c 'drop schema if exists public cascade' >/dev/null

restore_path=$(tool_path dump.custom pg_restore yes)
# pg_restore does not connect from PGDATABASE alone. It needs -d, or it
# writes SQL to stdout and refuses to run.
restore_db=$(awk -F= '$1 == "PGDATABASE" { print $2 }' "$PG_ENV_FILE")
run_pg pg_restore yes --exit-on-error --no-password --single-transaction -d "$restore_db" "$restore_path"
rm -f "$PG_WORK_DIR/dump.custom"
RESTORED=1

# shellcheck disable=SC1091
source "$ROOT/scripts/verify-restored-database.sh"

finished=$(date +%s)
printf 'restore_seconds=%s\n' $((finished - started))
printf 'backup_key=%s\n' "$key"
