#!/usr/bin/env bash
# Runs the migration against a throwaway local Postgres with a minimal stand-in
# for Supabase's auth schema, then checks the access rules as different users.
set -euo pipefail
cd "$(dirname "$0")/../.."
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
DIR=$(mktemp -d); PORT=55432
AS=""; if [ "$(id -u)" = 0 ]; then AS="runuser -u postgres --"; chown postgres "$DIR"; fi  # initdb refuses to run as root
$AS "$BIN/initdb" -D "$DIR" -U postgres >/dev/null
$AS "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
trap '$AS "$BIN/pg_ctl" -D "$DIR" stop >/dev/null; rm -rf "$DIR"' EXIT
PSQL="psql -h $DIR -p $PORT -U postgres -v ON_ERROR_STOP=1 -q -X"
$PSQL <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth; grant usage on schema auth to authenticated, anon;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to authenticated, anon;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'), ('00000000-0000-0000-0000-00000000000c');
SQL
$PSQL -f supabase/migrations/*_accounts.sql
$PSQL -o /dev/null <<'SQL' 2>&1 | sed 's/^.*NOTICE: *//'
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$ begin if not ok then raise exception 'FAILED: %', label; end if; raise notice 'ok %', label; end $$;
-- user A creates a company
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into companies (id, name, data) values ('c1', 'Alpha LLC', '{"name":"Alpha LLC"}');
select pg_temp.check((select role from company_members where company_id = 'c1') = 'owner', 'creator becomes owner');
update companies set data = '{"x":1}' where id = 'c1' and version = 1;
select pg_temp.check((select version from companies where id = 'c1') = 2, 'update bumps version');
update companies set data = '{"x":2}' where id = 'c1' and version = 1;
select pg_temp.check((select data->>'x' from companies where id = 'c1') = '1', 'stale version write is ignored');
-- user B sees nothing and cannot write
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from companies) = 0, 'other user cannot read');
update companies set name = 'hacked' where id = 'c1';
delete from companies where id = 'c1';
select pg_temp.check((select count(*) from company_members) = 0, 'other user cannot see members');
do $$ begin
  begin insert into companies (id, name, data, owner_id) values ('c2', 'Spoof', '{}', '00000000-0000-0000-0000-00000000000a'); raise exception 'spoofed owner allowed';
  exception when insufficient_privilege then raise notice 'ok cannot create company for someone else'; end;
  begin insert into company_members values ('c1', '00000000-0000-0000-0000-00000000000b', 'accountant'); raise exception 'self-invite allowed';
  exception when insufficient_privilege then raise notice 'ok cannot add self to a company'; end;
end $$;
-- A invites B as accountant, C as viewer
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into company_members values ('c1', '00000000-0000-0000-0000-00000000000b', 'accountant'), ('c1', '00000000-0000-0000-0000-00000000000c', 'viewer');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update companies set data = '{"x":3}' where id = 'c1';
select pg_temp.check((select data->>'x' from companies where id = 'c1') = '3', 'accountant can edit books');
delete from companies where id = 'c1';
select pg_temp.check((select count(*) from companies) = 1, 'accountant cannot delete company');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
update companies set data = '{"x":4}' where id = 'c1';
select pg_temp.check((select data->>'x' from companies where id = 'c1') = '3', 'viewer cannot edit');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update companies set owner_id = '00000000-0000-0000-0000-00000000000b' where id = 'c1';
select pg_temp.check((select owner_id from companies where id = 'c1') = '00000000-0000-0000-0000-00000000000a', 'owner cannot be changed by update');
delete from companies where id = 'c1';
select pg_temp.check((select count(*) from companies) = 0, 'owner can delete');
reset role;
select pg_temp.check((select count(*) from company_members) = 0, 'members removed with company');
set role anon; set request.jwt.claim.sub = '';
do $$ begin perform 1 from companies; raise exception 'anon read allowed'; exception when insufficient_privilege then raise notice 'ok signed-out visitors cannot read'; end $$;
SQL
echo "All database access checks passed"
