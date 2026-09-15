-- Apply after dating_1on1_card_profile_history.sql.
-- Changes only the history trigger; no accounts or profiles are deleted here.
begin;

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

  -- Ordinary profile deletion must still be audited. Only skip history when
  -- the parent Auth user is gone (ON DELETE CASCADE during account deletion).
  if tg_op = 'DELETE' and not exists (
    select 1 from auth.users u where u.id = target_row.user_id
  ) then
    return old;
  end if;

  insert into public.dating_1on1_card_profile_history (
    card_id, user_id, event_type, snapshot, created_at
  ) values (
    target_row.id, target_row.user_id, event_name, to_jsonb(target_row), now()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

commit;
