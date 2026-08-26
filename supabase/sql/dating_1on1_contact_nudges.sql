begin;

create table if not exists public.dating_1on1_contact_nudges (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.dating_1on1_match_proposals(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  preset_key text not null check (
    preset_key in ('want_to_exchange', 'when_comfortable', 'coffee_on_me', 'keep_talking')
  ),
  message_text text not null check (char_length(message_text) between 1 and 120),
  created_at timestamptz not null default now(),
  constraint dating_1on1_contact_nudges_not_self check (sender_user_id <> recipient_user_id),
  constraint dating_1on1_contact_nudges_preset_message check (
    (preset_key = 'want_to_exchange' and message_text = '저는 연락처를 교환하고 싶어요 🙂') or
    (preset_key = 'when_comfortable' and message_text = '부담 없으실 때 연락처 교환 진행해 주세요!') or
    (preset_key = 'coffee_on_me' and message_text = '연락처 교환해 주시면 첫 커피는 제가 살게요 ☕') or
    (preset_key = 'keep_talking' and message_text = '조금 더 이야기해보고 싶어요. 연락처 교환 어떠세요?')
  ),
  constraint dating_1on1_contact_nudges_sender_once unique (match_id, sender_user_id)
);

create or replace function public.validate_dating_1on1_contact_nudge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  match_row public.dating_1on1_match_proposals%rowtype;
  mutual_at timestamptz;
begin
  select *
    into match_row
  from public.dating_1on1_match_proposals
  where id = new.match_id
  for update;

  if not found then
    raise exception 'NUDGE_MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (
    (match_row.source_user_id = new.sender_user_id and match_row.candidate_user_id = new.recipient_user_id) or
    (match_row.candidate_user_id = new.sender_user_id and match_row.source_user_id = new.recipient_user_id)
  ) then
    raise exception 'NUDGE_PARTICIPANT_MISMATCH' using errcode = '23514';
  end if;

  mutual_at := coalesce(match_row.source_final_responded_at, match_row.updated_at, match_row.created_at);
  if match_row.state <> 'mutual_accepted'
    or match_row.contact_exchange_status <> 'awaiting_applicant_payment'
    or match_row.contact_exchange_paid_at is not null
    or match_row.contact_exchange_paid_by_user_id is not null
    or mutual_at is null
    or mutual_at > now() - interval '48 hours'
  then
    raise exception 'NUDGE_NOT_ELIGIBLE' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_dating_1on1_contact_nudge
  on public.dating_1on1_contact_nudges;
create trigger trg_validate_dating_1on1_contact_nudge
before insert on public.dating_1on1_contact_nudges
for each row execute function public.validate_dating_1on1_contact_nudge();

create index if not exists idx_dating_1on1_contact_nudges_recipient_created
  on public.dating_1on1_contact_nudges (recipient_user_id, created_at desc);

create index if not exists idx_dating_1on1_contact_nudges_match_created
  on public.dating_1on1_contact_nudges (match_id, created_at desc);

alter table public.dating_1on1_contact_nudges enable row level security;

-- 읽기와 쓰기는 참가자 검증을 수행하는 서버 API에서만 처리합니다.
revoke all on public.dating_1on1_contact_nudges from anon, authenticated;
revoke all on function public.validate_dating_1on1_contact_nudge() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
