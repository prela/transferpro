#!/bin/bash
# Runs once, on the first start of a fresh Postgres data directory.
# Passwords come from the environment written by scripts/setup-db-roles.sh.
set -euo pipefail

: "${TRANSFERPRO_OWNER_PASSWORD:?TRANSFERPRO_OWNER_PASSWORD is required}"
: "${TRANSFERPRO_APP_PASSWORD:?TRANSFERPRO_APP_PASSWORD is required}"
: "${TRANSFERPRO_AUTH_PASSWORD:?TRANSFERPRO_AUTH_PASSWORD is required}"
: "${TRANSFERPRO_QUEUE_PASSWORD:?TRANSFERPRO_QUEUE_PASSWORD is required}"
: "${TRANSFERPRO_PLATFORM_PASSWORD:?TRANSFERPRO_PLATFORM_PASSWORD is required}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE transferpro_owner LOGIN BYPASSRLS PASSWORD '${TRANSFERPRO_OWNER_PASSWORD}';
CREATE ROLE transferpro_app   LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${TRANSFERPRO_APP_PASSWORD}';
CREATE ROLE transferpro_auth  LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${TRANSFERPRO_AUTH_PASSWORD}';
CREATE ROLE transferpro_queue LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${TRANSFERPRO_QUEUE_PASSWORD}';
CREATE ROLE transferpro_platform LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${TRANSFERPRO_PLATFORM_PASSWORD}';

GRANT CONNECT ON DATABASE ${POSTGRES_DB} TO transferpro_owner, transferpro_app, transferpro_auth, transferpro_queue, transferpro_platform;
-- Migrations create schema app. CREATE on the database is not granted to PUBLIC.
-- The queue role is not granted CREATE. It owns schema pgboss because the
-- migrator is a member of that role and can AUTHORIZATION the schema to it.
GRANT CREATE ON DATABASE ${POSTGRES_DB} TO transferpro_owner;
GRANT transferpro_queue TO transferpro_owner;
SQL
