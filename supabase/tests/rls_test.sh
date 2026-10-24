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
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public to authenticated, anon;
insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'owner@example.com', now()), ('00000000-0000-0000-0000-00000000000b', 'acct@example.com', now()), ('00000000-0000-0000-0000-00000000000c', 'viewer@example.com', now()), ('00000000-0000-0000-0000-00000000000d', 'Late@Example.com', now()), ('00000000-0000-0000-0000-00000000000e', 'unconfirmed@example.com', null);
SQL
for f in supabase/migrations/*.sql; do $PSQL -f "$f"; done
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
-- invitations
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into companies (id, name, data) values ('c3', 'Gamma Co', '{}');
insert into company_invites (company_id, email, role) values ('c3', 'late@example.com', 'bookkeeper'), ('c3', 'unconfirmed@example.com', 'viewer'), ('c3', 'acct@example.com', 'accountant');
select pg_temp.check((select count(*) from company_invites) = 3, 'owner can invite and see invites');
do $$ begin
  begin insert into company_invites (company_id, email, role) values ('c3', 'x@example.com', 'owner'); raise exception 'owner invite allowed';
  exception when check_violation then raise notice 'ok cannot invite someone as owner'; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from company_invites) = 0, 'invitee cannot see the invite list');
do $$ begin
  begin insert into company_invites (company_id, email, role) values ('c3', 'friend@example.com', 'accountant'); raise exception 'non-owner invite allowed';
  exception when insufficient_privilege then raise notice 'ok non-owner cannot invite'; end;
end $$;
select pg_temp.check(accept_invites() = 1, 'invitee accepts on sign-in');
select pg_temp.check((select data from companies where id = 'c3') is not null, 'accepted invitee can read the company');
select pg_temp.check((select count(*) from company_people('c3')) = 2, 'member sees who has access');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check(accept_invites() = 1, 'email match ignores letter case');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.check(accept_invites() = 0, 'unconfirmed email cannot accept');
select pg_temp.check((select count(*) from company_people('c3')) = 0, 'non-member cannot list people');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
update company_members set role = 'owner' where company_id = 'c3' and user_id = auth.uid();
select pg_temp.check((select role from company_members where company_id = 'c3' and user_id = auth.uid()) = 'accountant', 'member cannot promote themselves');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update company_members set role = 'viewer' where company_id = 'c3' and user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select role from company_members where company_id = 'c3' and user_id = '00000000-0000-0000-0000-00000000000b') = 'viewer', 'owner can change a role');
do $$ begin
  begin update company_members set role = 'owner' where company_id = 'c3' and user_id = '00000000-0000-0000-0000-00000000000b'; raise exception 'second owner allowed';
  exception when insufficient_privilege then raise notice 'ok owner cannot hand out owner role'; end;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
delete from company_members where company_id = 'c3' and user_id = auth.uid();
select pg_temp.check((select count(*) from companies where id = 'c3') = 0, 'member can leave');
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
delete from company_members where company_id = 'c3' and user_id = auth.uid();
select pg_temp.check((select count(*) from company_members where company_id = 'c3' and role = 'owner') = 1, 'owner cannot remove themselves');
delete from company_members where company_id = 'c3' and user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select count(*) from company_people('c3')) = 1, 'owner can remove a member');
delete from company_invites where company_id = 'c3';
select pg_temp.check((select count(*) from company_invites) = 0, 'owner can cancel invites');
set role anon; set request.jwt.claim.sub = '';
do $$ begin perform 1 from companies; raise exception 'anon read allowed'; exception when insufficient_privilege then raise notice 'ok signed-out visitors cannot read'; end $$;
do $$ begin perform accept_invites(); raise exception 'anon accept allowed'; exception when insufficient_privilege then raise notice 'ok signed-out visitors cannot accept invites'; end $$;
SQL
echo "All database access checks passed"
