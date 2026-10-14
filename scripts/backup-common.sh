# Shared by scripts/backup-database.sh and scripts/restore-database.sh.
# Sourced, not executed. PostgreSQL 18 matches the preview server: an older
# pg_dump refuses to read it. BACKUP_PG_DOCKER_IMAGE is only for the
# disposable restore test. The scheduled task installs the client tools.

set -euo pipefail
umask 077

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# Docker Desktop does not see /tmp. The work directory stays in the repo
# tree, which the daemon can mount, and .gitignore keeps a crash from
# committing the connection files.
make_work_dir() {
  mkdir -p "$ROOT/.backup-work"
  PG_WORK_DIR=$(mktemp -d "$ROOT/.backup-work/run.XXXXXX")
}

require_var() {
  if [[ -z "${!1:-}" ]]; then
    printf '%s is required\n' "$1" >&2
    exit 1
  fi
}

pg_major() {
  local version
  version=$("$1" --version 2>/dev/null || true)
  if [[ "$version" =~ \(PostgreSQL\)[[:space:]]+([0-9]+) ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
  fi
}

# Returns 0 when the tool must run from BACKUP_PG_DOCKER_IMAGE.
use_docker_pg() {
  local tool=$1
  local need_18=$2
  if command -v "$tool" >/dev/null 2>&1; then
    if [[ "$need_18" != yes ]]; then
      return 1
    fi
    local major
    major=$(pg_major "$tool")
    if [[ -n "$major" && "$major" -ge 18 ]]; then
      return 1
    fi
  fi
  if [[ -z "${BACKUP_PG_DOCKER_IMAGE:-}" ]]; then
    printf '%s\n' "$tool 18 is required. Install the PostgreSQL 18 client tools." >&2
    exit 1
  fi
  return 0
}

# $1 tool, $2 yes|no (pg_dump and pg_restore need 18), then the tool's arguments.
# A path the tool reads or writes is /work/... when Docker is used.
run_pg() {
  local tool=$1
  local need_18=$2
  shift 2
  export PGCONNECT_TIMEOUT=30
  if use_docker_pg "$tool" "$need_18"; then
    docker run --rm -i --network host --user "$(id -u):$(id -g)" \
      --env-file "$PG_ENV_FILE" \
      -v "$PG_WORK_DIR:/work" \
      --entrypoint "$tool" \
      "$BACKUP_PG_DOCKER_IMAGE" \
      "$@"
  else
    set -a
    # shellcheck disable=SC1090
    . "$PG_LIBPQ_FILE"
    set +a
    "$tool" "$@"
  fi
}

prepare_connection() {
  PG_LIBPQ_FILE=$PG_WORK_DIR/libpq
  PG_ENV_FILE=$PG_WORK_DIR/docker.env
  node "$ROOT/scripts/backup-target.mjs" env "$1" "$PG_LIBPQ_FILE" "$PG_ENV_FILE"
}

# Host path of a file in the work directory, as the pg tool must spell it.
tool_path() {
  local name=$1
  local tool=$2
  local need_18=$3
  if use_docker_pg "$tool" "$need_18"; then
    printf '/work/%s' "$name"
  else
    printf '%s/%s' "$PG_WORK_DIR" "$name"
  fi
}

psql_value() {
  run_pg psql no -q --no-psqlrc --no-password -v ON_ERROR_STOP=1 -tA "$@"
}
