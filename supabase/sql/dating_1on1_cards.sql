begin;

create table if not exists public.dating_1on1_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 30),
  birth_year int not null check (birth_year between 1960 and 2010),
  height_cm int not null check (height_cm between 120 and 230),
  job text not null check (char_length(job) between 1 and 80),
  region text not null check (char_length(region) between 1 and 80),
  phone text not null check (char_length(phone) between 9 and 15),
  intro_text text not null check (char_length(intro_text) between 1 and 2000),
  strengths_text text not null check (char_length(strengths_text) between 1 and 1000),
  preferred_partner_text text not null check (char_length(preferred_partner_text) between 1 and 1000),
  smoking text not null check (smoking in ('non_smoker', 'occasional', 'smoker')),
  workout_frequency text null check (workout_frequency in ('none', '1_2', '3_4', '5_plus')),
  photo_paths jsonb not null default '[]'::jsonb,
  consent_fake_info boolean not null default false,
  consent_no_show boolean not null default false,
  consent_fee boolean not null default false,
  consent_privacy boolean not null default false,
  status text not null default 'submitted' check (status in ('submitted', 'reviewing', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dating_1on1_cards_created_at
  on public.dating_1on1_cards (created_at desc);

create index if not exists idx_dating_1on1_cards_user_id
  on public.dating_1on1_cards (user_id, created_at desc);

create index if not exists idx_dating_1on1_cards_status
  on public.dating_1on1_cards (status, created_at desc);

alter table public.dating_1on1_cards enable row level security;

drop policy if exists "dating_1on1_insert_own" on public.dating_1on1_cards;
create policy "dating_1on1_insert_own"
  on public.dating_1on1_cards for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "dating_1on1_admin_select" on public.dating_1on1_cards;
create policy "dating_1on1_admin_select"
  on public.dating_1on1_cards for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "dating_1on1_admin_update" on public.dating_1on1_cards;
create policy "dating_1on1_admin_update"
  on public.dating_1on1_cards for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "dating_1on1_admin_delete" on public.dating_1on1_cards;
create policy "dating_1on1_admin_delete"
  on public.dating_1on1_cards for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

insert into public.site_settings (key, value_json)
values ('dating_1on1_write_status', '{"status":"approved"}'::jsonb)
on conflict (key) do nothing;

commit;

notify pgrst, 'reload schema';

