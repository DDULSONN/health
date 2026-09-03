begin;

create table if not exists public.dating_1on1_candidate_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  candidate_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint dating_1on1_candidate_favorites_not_self check (source_card_id <> candidate_card_id),
  constraint dating_1on1_candidate_favorites_unique unique (user_id, source_card_id, candidate_card_id)
);

create index if not exists idx_dating_1on1_candidate_favorites_user_source
  on public.dating_1on1_candidate_favorites (user_id, source_card_id, created_at desc);

alter table public.dating_1on1_candidate_favorites enable row level security;

create or replace function public.enforce_dating_1on1_candidate_favorite_limit()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || new.source_card_id::text, 0));
  if (
    select count(*)
    from public.dating_1on1_candidate_favorites
    where user_id = new.user_id and source_card_id = new.source_card_id
  ) >= 10 then
    raise exception 'ONE_ON_ONE_FAVORITE_LIMIT_REACHED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dating_1on1_candidate_favorite_limit on public.dating_1on1_candidate_favorites;
create trigger trg_dating_1on1_candidate_favorite_limit
before insert on public.dating_1on1_candidate_favorites
for each row execute function public.enforce_dating_1on1_candidate_favorite_limit();

drop policy if exists dating_1on1_candidate_favorites_select_own on public.dating_1on1_candidate_favorites;
create policy dating_1on1_candidate_favorites_select_own
  on public.dating_1on1_candidate_favorites for select
  using (auth.uid() = user_id);

drop policy if exists dating_1on1_candidate_favorites_insert_own on public.dating_1on1_candidate_favorites;
create policy dating_1on1_candidate_favorites_insert_own
  on public.dating_1on1_candidate_favorites for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.dating_1on1_cards source_card
      where source_card.id = source_card_id and source_card.user_id = auth.uid()
    )
  );

drop policy if exists dating_1on1_candidate_favorites_delete_own on public.dating_1on1_candidate_favorites;
create policy dating_1on1_candidate_favorites_delete_own
  on public.dating_1on1_candidate_favorites for delete
  using (auth.uid() = user_id);

create table if not exists public.dating_1on1_sms_deliveries (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.dating_1on1_match_proposals(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_kind text not null check (event_kind in ('selection_received')),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_error text,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  constraint dating_1on1_sms_deliveries_unique unique (match_id, recipient_user_id, event_kind)
);

create index if not exists idx_dating_1on1_sms_deliveries_recipient_created
  on public.dating_1on1_sms_deliveries (recipient_user_id, created_at desc);

alter table public.dating_1on1_sms_deliveries enable row level security;
revoke all on public.dating_1on1_sms_deliveries from anon, authenticated;

commit;
