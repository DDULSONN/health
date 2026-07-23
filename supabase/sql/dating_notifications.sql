begin;

alter table public.notifications
  add column if not exists meta_json jsonb not null default '{}'::jsonb;

alter table public.notifications
  alter column post_id drop not null;

alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (
    type in (
      'comment',
      'dating_application_received',
      'dating_application_accepted',
      'dating_application_rejected',
      'dating_swipe_like_received',
      'dating_swipe_match_created',
      'dating_1on1_selection_received',
      'dating_1on1_match_accepted',
      'dating_1on1_match_canceled'
    )
  );

commit;

notify pgrst, 'reload schema';
