-- Add strengths_text + photo_visibility to open dating cards.
-- - strengths_text: up to 150 chars, publicly visible
-- - photo_visibility: blur/public switch for public card image rendering

begin;

alter table public.dating_cards
  add column if not exists strengths_text text,
  add column if not exists photo_visibility text not null default 'blur';

alter table public.dating_cards
  drop constraint if exists dating_cards_strengths_text_length_check;

alter table public.dating_cards
  add constraint dating_cards_strengths_text_length_check
  check (strengths_text is null or length(strengths_text) <= 150);

alter table public.dating_cards
  drop constraint if exists dating_cards_photo_visibility_check;

alter table public.dating_cards
  add constraint dating_cards_photo_visibility_check
  check (photo_visibility in ('blur', 'public'));

commit;

notify pgrst, 'reload schema';
