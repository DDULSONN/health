begin;

create table if not exists public.site_settings (
  key text primary key,
  value_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.site_settings (key, value_json)
values (
  'community_top_banner',
  '{"enabled": false, "title": "", "description": "", "cta": "자세히 보기", "linkUrl": ""}'::jsonb
)
on conflict (key) do nothing;

insert into public.site_settings (key, value_json)
values (
  'ad_inquiry_slot',
  '{"enabled": false, "title": "헬스장 로테이션 소개팅 참여하기", "description": "배너, 제휴, 스폰서 문의는 오픈카톡으로 편하게 남겨 주세요.", "cta": "자세히 보기", "linkUrl": "https://open.kakao.com/o/s2gvTdhi", "badge": "AD"}'::jsonb
)
on conflict (key) do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "site_settings_select_all" on public.site_settings;
create policy "site_settings_select_all"
  on public.site_settings for select
  to authenticated
  using (true);

drop policy if exists "site_settings_admin_all" on public.site_settings;
create policy "site_settings_admin_all"
  on public.site_settings for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
