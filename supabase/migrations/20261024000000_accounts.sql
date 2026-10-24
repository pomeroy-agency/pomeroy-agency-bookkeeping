-- Ledgerline: user accounts and company books
--
-- Each company's books are stored as one JSON document (the same shape the
-- browser app uses), guarded by row-level security so people only ever see
-- companies they belong to. Moving the ledger into relational tables is a
-- later step; this keeps the app and database in lockstep while the engine
-- still runs in the browser.

create table public.companies (
  id          text primary key,
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(name) between 1 and 200),
  data        jsonb not null,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.company_members (
  company_id  text not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'accountant', 'bookkeeper', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index company_members_user_idx on public.company_members (user_id);
create index companies_owner_idx on public.companies (owner_id);

-- Membership check that runs with the definer's rights, so policies on
-- company_members can call it without recursing into their own policy.
create function public.member_role(cid text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.company_members where company_id = cid and user_id = auth.uid()
$$;

-- The creator of a company becomes its owner member.
create function public.add_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_members (company_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger companies_add_owner
after insert on public.companies
for each row execute function public.add_owner_member();

-- Every save bumps the version. The app sends the version it loaded, and the
-- update matches zero rows if someone else saved first.
create function public.touch_company()
returns trigger
language plpgsql
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.owner_id := old.owner_id;
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger companies_touch
before update on public.companies
for each row execute function public.touch_company();

alter table public.companies enable row level security;
alter table public.company_members enable row level security;

create policy "members read their companies" on public.companies
  for select to authenticated
  using (owner_id = auth.uid() or public.member_role(id) is not null);

create policy "people create companies they own" on public.companies
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "owners and staff edit books" on public.companies
  for update to authenticated
  using (public.member_role(id) in ('owner', 'accountant', 'bookkeeper'))
  with check (public.member_role(id) in ('owner', 'accountant', 'bookkeeper'));

create policy "owners delete companies" on public.companies
  for delete to authenticated
  using (owner_id = auth.uid());

create policy "members see who else is on the company" on public.company_members
  for select to authenticated
  using (public.member_role(company_id) is not null);

create policy "owners add members" on public.company_members
  for insert to authenticated
  with check (public.member_role(company_id) = 'owner' and role <> 'owner');

create policy "owners remove members" on public.company_members
  for delete to authenticated
  using (public.member_role(company_id) = 'owner' and role <> 'owner');

revoke all on public.companies, public.company_members from anon;
grant select, insert, update, delete on public.companies, public.company_members to authenticated;
