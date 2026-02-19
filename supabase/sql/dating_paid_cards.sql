-- Paid dating cards (manual payment + admin approval flow)

begin;

create table if not exists public.dating_paid_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  gender text not null check (gender in ('M', 'F')),
  age int null,
  region text null,
  height_cm int null,
  job text null,
  training_years int null,
  is_3lift_verified boolean not null default false,
  strengths_text text null,
  ideal_text text null,
  intro_text text null,
  instagram_id text not null check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$'),
  photo_visibility text not null default 'blur' check (photo_visibility in ('blur', 'public')),
  blur_thumb_path text null,
  photo_paths text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  paid_at timestamptz null,
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_dating_paid_cards_status_expires
  on public.dating_paid_cards (status, expires_at);
create index if not exists idx_dating_paid_cards_user_created
  on public.dating_paid_cards (user_id, created_at desc);
create index if not exists idx_dating_paid_cards_paid_at
  on public.dating_paid_cards (paid_at asc nulls last, created_at asc);

alter table public.dating_paid_cards enable row level security;

drop policy if exists "dating_paid_cards_insert_own" on public.dating_paid_cards;
create policy "dating_paid_cards_insert_own"
  on public.dating_paid_cards for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "dating_paid_cards_select_own" on public.dating_paid_cards;
create policy "dating_paid_cards_select_own"
  on public.dating_paid_cards for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "dating_paid_cards_select_public" on public.dating_paid_cards;
create policy "dating_paid_cards_select_public"
  on public.dating_paid_cards for select
  to anon, authenticated
  using (status = 'approved' and expires_at > now());

drop policy if exists "dating_paid_cards_update_own_pending" on public.dating_paid_cards;
create policy "dating_paid_cards_update_own_pending"
  on public.dating_paid_cards for update
  to authenticated
  using (auth.uid() = user_id and status = 'pending')
  with check (auth.uid() = user_id and status = 'pending');

drop policy if exists "dating_paid_cards_admin_all" on public.dating_paid_cards;
create policy "dating_paid_cards_admin_all"
  on public.dating_paid_cards for all
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

commit;

notify pgrst, 'reload schema';
