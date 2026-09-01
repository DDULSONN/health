begin;

-- Meaningful activity is maintained by database triggers so an auto-login user
-- is not mistaken for an abandoned account merely because the auth login time is old.
alter table public.profiles
  add column if not exists last_meaningful_activity_at timestamptz;

alter table public.dating_cards
  add column if not exists inactivity_notice_sent_at timestamptz,
  add column if not exists inactivity_notice_baseline_at timestamptz,
  add column if not exists inactivity_deferred_at timestamptz;

create index if not exists idx_dating_cards_inactivity_queue
  on public.dating_cards (status, auto_requeue_count, inactivity_deferred_at, queue_priority_at);

create or replace function public.touch_member_meaningful_activity(
  p_user_id uuid,
  p_activity_at timestamptz default now()
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set last_meaningful_activity_at = greatest(
    coalesce(last_meaningful_activity_at, '-infinity'::timestamptz),
    coalesce(p_activity_at, now())
  )
  where user_id = p_user_id
    and (
      last_meaningful_activity_at is null
      or last_meaningful_activity_at < coalesce(p_activity_at, now()) - interval '5 minutes'
    );
$$;

revoke all on function public.touch_member_meaningful_activity(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.track_simple_member_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_activity_at timestamptz;
begin
  v_user_id := nullif(to_jsonb(new) ->> TG_ARGV[0], '')::uuid;
  v_activity_at := coalesce(
    nullif(to_jsonb(new) ->> 'updated_at', '')::timestamptz,
    nullif(to_jsonb(new) ->> 'created_at', '')::timestamptz,
    now()
  );
  if v_user_id is not null then
    perform public.touch_member_meaningful_activity(v_user_id, v_activity_at);
  end if;
  return new;
end;
$$;

revoke all on function public.track_simple_member_activity()
  from public, anon, authenticated;

drop trigger if exists trg_posts_member_activity on public.posts;
create trigger trg_posts_member_activity after insert or update on public.posts
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_comments_member_activity on public.comments;
create trigger trg_comments_member_activity after insert or update on public.comments
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_votes_member_activity on public.votes;
create trigger trg_votes_member_activity after insert or update on public.votes
for each row execute function public.track_simple_member_activity('voter_id');

drop trigger if exists trg_post_reactions_member_activity on public.post_reactions;
create trigger trg_post_reactions_member_activity after insert or update on public.post_reactions
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_dating_swipes_member_activity on public.dating_card_swipes;
create trigger trg_dating_swipes_member_activity after insert or update on public.dating_card_swipes
for each row execute function public.track_simple_member_activity('actor_user_id');

drop trigger if exists trg_dating_chat_messages_member_activity on public.dating_chat_messages;
create trigger trg_dating_chat_messages_member_activity after insert on public.dating_chat_messages
for each row execute function public.track_simple_member_activity('sender_id');

drop trigger if exists trg_contact_nudges_member_activity on public.dating_1on1_contact_nudges;
create trigger trg_contact_nudges_member_activity after insert on public.dating_1on1_contact_nudges
for each row execute function public.track_simple_member_activity('sender_user_id');

drop trigger if exists trg_fit_room_entries_member_activity on public.community_fit_room_entries;
create trigger trg_fit_room_entries_member_activity after insert on public.community_fit_room_entries
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_fit_room_comments_member_activity on public.community_fit_room_comments;
create trigger trg_fit_room_comments_member_activity after insert on public.community_fit_room_comments
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_fit_room_reactions_member_activity on public.community_fit_room_reactions;
create trigger trg_fit_room_reactions_member_activity after insert or update on public.community_fit_room_reactions
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_lift_records_member_activity on public.lift_records;
create trigger trg_lift_records_member_activity after insert on public.lift_records
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_support_inquiries_member_activity on public.support_inquiries;
create trigger trg_support_inquiries_member_activity after insert on public.support_inquiries
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_payment_orders_member_activity on public.toss_test_payment_orders;
create trigger trg_payment_orders_member_activity after insert on public.toss_test_payment_orders
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_more_view_requests_member_activity on public.dating_more_view_requests;
create trigger trg_more_view_requests_member_activity after insert on public.dating_more_view_requests
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_city_view_requests_member_activity on public.dating_city_view_requests;
create trigger trg_city_view_requests_member_activity after insert on public.dating_city_view_requests
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_swipe_subscription_member_activity on public.dating_swipe_subscription_requests;
create trigger trg_swipe_subscription_member_activity after insert on public.dating_swipe_subscription_requests
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_cert_requests_member_activity on public.cert_requests;
create trigger trg_cert_requests_member_activity after insert on public.cert_requests
for each row execute function public.track_simple_member_activity('user_id');

drop trigger if exists trg_gym_class_applications_member_activity on public.gym_class_applications;
create trigger trg_gym_class_applications_member_activity after insert on public.gym_class_applications
for each row execute function public.track_simple_member_activity('applicant_user_id');

drop trigger if exists trg_dating_applications_member_activity on public.dating_card_applications;
create trigger trg_dating_applications_member_activity after insert on public.dating_card_applications
for each row execute function public.track_simple_member_activity('applicant_user_id');

create or replace function public.track_open_card_owner_response_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_user_id uuid;
begin
  if new.status is distinct from old.status then
    if new.status = 'canceled' then
      perform public.touch_member_meaningful_activity(new.applicant_user_id, now());
    elsif new.status in ('accepted', 'rejected') then
      select owner_user_id into v_owner_user_id
      from public.dating_cards
      where id = new.card_id;
      if v_owner_user_id is not null then
        perform public.touch_member_meaningful_activity(v_owner_user_id, now());
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.track_open_card_owner_response_activity()
  from public, anon, authenticated;

drop trigger if exists trg_open_card_owner_response_activity on public.dating_card_applications;
create trigger trg_open_card_owner_response_activity after update on public.dating_card_applications
for each row execute function public.track_open_card_owner_response_activity();

create or replace function public.track_open_card_content_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.touch_member_meaningful_activity(new.owner_user_id, now());
  elsif row(new.display_nickname, new.sex, new.age, new.region, new.height_cm, new.job,
            new.training_years, new.strengths_text, new.ideal_type, new.instagram_id,
            new.photo_paths)
        is distinct from
        row(old.display_nickname, old.sex, old.age, old.region, old.height_cm, old.job,
            old.training_years, old.strengths_text, old.ideal_type, old.instagram_id,
            old.photo_paths) then
    perform public.touch_member_meaningful_activity(new.owner_user_id, now());
  end if;
  return new;
end;
$$;

revoke all on function public.track_open_card_content_activity()
  from public, anon, authenticated;

drop trigger if exists trg_open_card_content_activity on public.dating_cards;
create trigger trg_open_card_content_activity after insert or update on public.dating_cards
for each row execute function public.track_open_card_content_activity();

create or replace function public.track_one_on_one_response_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_selected_at is distinct from old.source_selected_at
     or new.source_final_responded_at is distinct from old.source_final_responded_at then
    perform public.touch_member_meaningful_activity(
      new.source_user_id,
      greatest(new.source_selected_at, new.source_final_responded_at)
    );
  end if;
  if new.candidate_responded_at is distinct from old.candidate_responded_at then
    perform public.touch_member_meaningful_activity(new.candidate_user_id, new.candidate_responded_at);
  end if;
  return new;
end;
$$;

revoke all on function public.track_one_on_one_response_activity()
  from public, anon, authenticated;

drop trigger if exists trg_one_on_one_response_activity on public.dating_1on1_match_proposals;
create trigger trg_one_on_one_response_activity after update on public.dating_1on1_match_proposals
for each row execute function public.track_one_on_one_response_activity();

-- Seed the signal from existing user-authored records. Auth last_sign_in_at is
-- also checked by the cron, so this backfill intentionally covers explicit actions only.
with activity as (
  select user_id, max(activity_at) as activity_at
  from (
    select user_id, max(created_at) as activity_at from public.posts group by user_id
    union all select user_id, max(created_at) from public.comments group by user_id
    union all select voter_id, max(coalesce(updated_at, created_at)) from public.votes group by voter_id
    union all select user_id, max(coalesce(updated_at, created_at)) from public.post_reactions group by user_id
    union all select applicant_user_id, max(created_at) from public.dating_card_applications group by applicant_user_id
    union all select actor_user_id, max(created_at) from public.dating_card_swipes group by actor_user_id
    union all select sender_id, max(created_at) from public.dating_chat_messages group by sender_id
    union all select sender_user_id, max(created_at) from public.dating_1on1_contact_nudges group by sender_user_id
    union all select user_id, max(created_at) from public.community_fit_room_entries group by user_id
    union all select user_id, max(created_at) from public.community_fit_room_comments group by user_id
    union all select user_id, max(coalesce(updated_at, created_at)) from public.community_fit_room_reactions group by user_id
    union all select user_id, max(created_at) from public.lift_records group by user_id
    union all select user_id, max(created_at) from public.support_inquiries group by user_id
    union all select user_id, max(created_at) from public.toss_test_payment_orders group by user_id
    union all select user_id, max(created_at) from public.dating_more_view_requests group by user_id
    union all select user_id, max(created_at) from public.dating_city_view_requests group by user_id
    union all select user_id, max(created_at) from public.dating_swipe_subscription_requests group by user_id
    union all select user_id, max(created_at) from public.cert_requests group by user_id
    union all select applicant_user_id, max(created_at) from public.gym_class_applications group by applicant_user_id
    union all select source_user_id, max(greatest(source_selected_at, source_final_responded_at))
      from public.dating_1on1_match_proposals
      where source_selected_at is not null or source_final_responded_at is not null
      group by source_user_id
    union all select candidate_user_id, max(candidate_responded_at)
      from public.dating_1on1_match_proposals
      where candidate_responded_at is not null
      group by candidate_user_id
  ) signals
  where user_id is not null
  group by user_id
)
update public.profiles p
set last_meaningful_activity_at = greatest(
  coalesce(p.last_meaningful_activity_at, '-infinity'::timestamptz),
  activity.activity_at
)
from activity
where p.user_id = activity.user_id;

commit;
