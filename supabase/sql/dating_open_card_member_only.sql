-- Administrator-only, per-OpenCard restriction. Status, queue/expiry, matching,
-- applications, photo preferences and signed-in/owner policies remain unchanged.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

alter table public.dating_cards add column if not exists members_only boolean not null default false;
create index if not exists dating_cards_members_only_owner_idx
  on public.dating_cards (owner_user_id) where members_only;

-- Guard against an unexpected earlier definition on a re-apply. A compatible
-- re-apply preserves all existing privacy flags, rather than rebuilding them.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.dating_cards'::regclass and a.attname = 'members_only'
      and not a.attisdropped and a.atttypid = 'boolean'::regtype and a.attnotnull
      and pg_catalog.pg_get_expr(d.adbin,d.adrelid) = 'false'
  ) then raise exception 'Incompatible dating_cards.members_only definition'; end if;
end;
$$;

-- Existing permissive policies decide which public rows are normally visible.
-- An additional permissive policy would be ORed with those and fail to hide.
drop policy if exists dating_cards_members_only_anon on public.dating_cards;
create policy dating_cards_members_only_anon on public.dating_cards
  as restrictive for select to anon using (not members_only);

create or replace function public.guard_dating_open_card_members_only()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  if current_user in ('service_role','postgres') then return new; end if;
  if tg_op = 'INSERT' then
    if new.members_only is distinct from false then
      raise exception 'OpenCard member-only visibility is managed by the operator' using errcode = '42501';
    end if;
  elsif new.members_only is distinct from old.members_only then
    raise exception 'OpenCard member-only visibility is managed by the operator' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists dating_cards_guard_members_only on public.dating_cards;
create trigger dating_cards_guard_members_only before insert or update of members_only on public.dating_cards
  for each row execute function public.guard_dating_open_card_members_only();
revoke all on function public.guard_dating_open_card_members_only() from public, anon, authenticated, service_role;

commit;
notify pgrst, 'reload schema';
