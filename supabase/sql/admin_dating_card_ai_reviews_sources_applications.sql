begin;

alter table public.admin_dating_card_ai_reviews
  drop constraint if exists admin_dating_card_ai_reviews_source_type_check;

alter table public.admin_dating_card_ai_reviews
  add constraint admin_dating_card_ai_reviews_source_type_check
  check (
    source_type in (
      'open_card',
      'paid_card',
      'one_on_one',
      'open_card_application',
      'paid_card_application',
      'one_on_one_application'
    )
  );

commit;

notify pgrst, 'reload schema';
