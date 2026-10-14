#!/usr/bin/env bash
# Dump the preview database, encrypt, then upload. The plaintext file is
# removed before the upload. Retention is 14 daily objects (issue #234).

set -euo pipefail
# shellcheck disable=SC1091
source "$(dirname "$0")/backup-common.sh"

require_var BACKUP_DATABASE_URL
require_var BACKUP_GPG_PASSPHRASE
require_var BACKUP_S3_BUCKET
require_var BACKUP_S3_ENDPOINT
require_var AWS_ACCESS_KEY_ID
require_var AWS_SECRET_ACCESS_KEY

make_work_dir
trap 'rm -rf "$PG_WORK_DIR"' EXIT
export GNUPGHOME=$PG_WORK_DIR/gnupg
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"

prepare_connection "$BACKUP_DATABASE_URL"
dump_path=$(tool_path dump.custom pg_dump yes)
run_pg pg_dump yes -Fc --no-password -f "$dump_path"

# passphrase-fd keeps the secret off the process arguments. The same
# here-string is used to decrypt, so a trailing newline stays consistent.
gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
  --cipher-algo AES256 --symmetric \
  --output "$PG_WORK_DIR/dump.gpg" "$PG_WORK_DIR/dump.custom" \
  3<<<"$BACKUP_GPG_PASSPHRASE"
rm -f "$PG_WORK_DIR/dump.custom"

key=$(node "$ROOT/scripts/s3-object.mjs" key)
node "$ROOT/scripts/s3-object.mjs" put "$PG_WORK_DIR/dump.gpg" "$key"
node "$ROOT/scripts/s3-object.mjs" prune
printf 'backup_key=%s\n' "$key"
