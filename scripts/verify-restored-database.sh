# Sourced by scripts/restore-database.sh after pg_restore.
# The migration journal, the five roles, the app login, and tenant isolation.
# set_config returns the tenant id, so captured psql output drops that line.
# The check is the rows a session can see, not the policy text.

expected=$(node --input-type=module -e "
import { readFileSync } from 'node:fs'
const journal = JSON.parse(readFileSync('db/migrations/meta/_journal.json', 'utf8'))
process.stdout.write(String(journal.entries.length))
")
actual=$(psql_value -c 'select count(*) from drizzle.__drizzle_migrations')
if [[ "$actual" != "$expected" ]]; then
  printf 'migration journal count is %s, repo has %s\n' "$actual" "$expected" >&2
  exit 1
fi

roles=$(psql_value -c "select count(*) from pg_roles where rolname in ('transferpro_owner', 'transferpro_app', 'transferpro_auth', 'transferpro_queue', 'transferpro_platform')")
if [[ "$roles" != 5 ]]; then
  printf 'expected 5 database roles, found %s\n' "$roles" >&2
  exit 1
fi

prepare_connection "$RESTORE_APP_DATABASE_URL"
app_user=$(psql_value -c 'select current_user')
if [[ "$app_user" != "transferpro_app" ]]; then
  printf 'app connection is %s\n' "$app_user" >&2
  exit 1
fi

tenant_a=00000000-0000-4000-8000-000000000234
tenant_b=00000000-0000-4000-8000-000000000235

# Drops the tenant id that set_config prints. Leaves the query rows.
without_tenant_id() {
  awk '$0 !~ /^00000000-/'
}

psql_value -f - >/dev/null <<SQL
begin;
select set_config('app.tenant_id', '${tenant_a}', true);
insert into app.tenant_settings (default_locale, time_zone) values ('hr', 'Europe/Zagreb');
commit;
SQL

psql_value -f - >/dev/null <<SQL
begin;
select set_config('app.tenant_id', '${tenant_b}', true);
insert into app.tenant_settings (default_locale, time_zone) values ('en', 'Europe/Zagreb');
commit;
SQL

seen_by_b=$(psql_value -f - <<SQL | without_tenant_id
begin;
select set_config('app.tenant_id', '${tenant_b}', true);
select default_locale from app.tenant_settings order by default_locale;
commit;
SQL
)
if [[ "$seen_by_b" != en ]]; then
  printf 'tenant isolation failed: the other tenant is visible\n' >&2
  exit 1
fi

updated=$(psql_value -f - <<SQL | without_tenant_id
begin;
select set_config('app.tenant_id', '${tenant_b}', true);
with updated as (
  update app.tenant_settings set time_zone = 'Europe/Paris' returning 1
)
select count(*) from updated;
commit;
SQL
)
if [[ "$updated" != 1 ]]; then
  printf 'tenant isolation failed: update touched %s rows\n' "$updated" >&2
  exit 1
fi

kept=$(psql_value -f - <<SQL | without_tenant_id
begin;
select set_config('app.tenant_id', '${tenant_a}', true);
select time_zone from app.tenant_settings;
commit;
SQL
)
if [[ "$kept" != "Europe/Zagreb" ]]; then
  printf 'tenant isolation failed: the other tenant changed this row\n' >&2
  exit 1
fi

hidden=$(psql_value -c "select count(*) from app.tenant_settings where tenant_id in ('${tenant_a}', '${tenant_b}')")
if [[ "$hidden" != 0 ]]; then
  printf 'tenant isolation failed: a session without a tenant saw rows\n' >&2
  exit 1
fi

prepare_connection "$RESTORE_DATABASE_URL"
psql_value -c "delete from app.tenant_settings where tenant_id in ('${tenant_a}', '${tenant_b}')" >/dev/null
