begin;

alter table public.dating_city_view_requests
  add column if not exists target_sex text;

alter table public.dating_city_view_requests
  drop constraint if exists dating_city_view_requests_target_sex_check;

alter table public.dating_city_view_requests
  add constraint dating_city_view_requests_target_sex_check
  check (target_sex is null or target_sex in ('male', 'female'));

notify pgrst, 'reload schema';

commit;
