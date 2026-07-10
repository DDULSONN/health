begin;

create table if not exists public.dating_1on1_card_profile_history (
  id uuid primary key default gen_random_uuid(),
  card_id uuid,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'updated', 'deleted')),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dating_1on1_card_profile_history_user_created
  on public.dating_1on1_card_profile_history (user_id, created_at desc);

create index if not exists idx_dating_1on1_card_profile_history_card_created
  on public.dating_1on1_card_profile_history (card_id, created_at desc);

alter table public.dating_1on1_card_profile_history enable row level security;

drop policy if exists "dating_1on1_card_profile_history_admin_select" on public.dating_1on1_card_profile_history;
create policy "dating_1on1_card_profile_history_admin_select"
  on public.dating_1on1_card_profile_history for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

create or replace function public.record_dating_1on1_card_profile_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.dating_1on1_cards%rowtype;
  event_name text;
begin
  if tg_op = 'INSERT' then
    target_row := new;
    event_name := 'created';
  elsif tg_op = 'UPDATE' then
    target_row := new;
    event_name := 'updated';
  elsif tg_op = 'DELETE' then
    target_row := old;
    event_name := 'deleted';
  else
    return null;
  end if;

  insert into public.dating_1on1_card_profile_history (
    card_id,
    user_id,
    event_type,
    snapshot,
    created_at
  )
  values (
    target_row.id,
    target_row.user_id,
    event_name,
    to_jsonb(target_row),
    now()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dating_1on1_card_profile_history on public.dating_1on1_cards;
create trigger trg_dating_1on1_card_profile_history
  after insert or update or delete on public.dating_1on1_cards
  for each row
  execute function public.record_dating_1on1_card_profile_history();

insert into public.dating_1on1_card_profile_history (
  card_id,
  user_id,
  event_type,
  snapshot,
  created_at
)
select
  c.id,
  c.user_id,
  'created',
  to_jsonb(c),
  coalesce(c.created_at, now())
from public.dating_1on1_cards c
where not exists (
  select 1
  from public.dating_1on1_card_profile_history h
  where h.card_id = c.id
);

commit;

notify pgrst, 'reload schema';
