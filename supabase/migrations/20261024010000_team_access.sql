-- Ledgerline: inviting people to a company
--
-- An owner invites someone by email with a role. The invite waits until a
-- person with that confirmed email signs in, then turns into membership.
-- Nothing is emailed by the database; the owner tells the person to sign up.

create table public.company_invites (
  company_id  text not null references public.companies (id) on delete cascade,
  email       text not null check (email = lower(email) and email like '%_@_%'),
  role        text not null check (role in ('accountant', 'bookkeeper', 'viewer')),
  invited_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (company_id, email)
);

alter table public.company_invites enable row level security;

create policy "owners see invites" on public.company_invites
  for select to authenticated
  using (public.member_role(company_id) = 'owner');

create policy "owners invite" on public.company_invites
  for insert to authenticated
  with check (public.member_role(company_id) = 'owner' and invited_by = auth.uid());

create policy "owners cancel invites" on public.company_invites
  for delete to authenticated
  using (public.member_role(company_id) = 'owner');

-- Owners can change a member's role, but never to or from owner.
create policy "owners change roles" on public.company_members
  for update to authenticated
  using (public.member_role(company_id) = 'owner' and role <> 'owner')
  with check (public.member_role(company_id) = 'owner' and role <> 'owner');

-- Anyone other than the owner can leave a company.
create policy "members leave" on public.company_members
  for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');

-- Turns any invites for the signed-in person's confirmed email into memberships.
-- Returns how many companies were added.
create function public.accept_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text;
  added integer;
begin
  select lower(email) into my_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if my_email is null then
    return 0;
  end if;
  insert into public.company_members (company_id, user_id, role)
    select company_id, auth.uid(), role from public.company_invites where email = my_email
    on conflict (company_id, user_id) do nothing;
  get diagnostics added = row_count;
  delete from public.company_invites where email = my_email;
  return added;
end;
$$;

-- Who has access to a company, with their email. Only members can ask.
create function public.company_people(cid text)
returns table (user_id uuid, email text, role text, added_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.company_members m
  join auth.users u on u.id = m.user_id
  where m.company_id = cid and public.member_role(cid) is not null
  order by case m.role when 'owner' then 0 else 1 end, m.created_at
$$;

revoke all on public.company_invites from anon;
grant select, insert, delete on public.company_invites to authenticated;
revoke execute on function public.accept_invites(), public.company_people(text) from public, anon;
grant execute on function public.accept_invites(), public.company_people(text) to authenticated;
