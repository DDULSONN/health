begin;

insert into storage.buckets (id, name, public)
values ('community-fit-room', 'community-fit-room', false)
on conflict (id) do nothing;

create table if not exists public.community_fit_room_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'workout' check (kind in ('workout', 'diet', 'body')),
  caption text not null default '',
  image_path text not null,
  expires_at timestamptz not null default timezone('utc', now()) + interval '24 hours',
  deleted_at timestamptz null,
  deleted_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.community_fit_room_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.community_fit_room_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  deleted_at timestamptz null,
  deleted_by_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.community_fit_room_reactions (
  entry_id uuid not null references public.community_fit_room_entries(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('up', 'down')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (entry_id, user_id)
);

create table if not exists public.community_fit_room_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  entry_id uuid null references public.community_fit_room_entries(id) on delete cascade,
  comment_id uuid null references public.community_fit_room_comments(id) on delete cascade,
  target_user_id uuid null references auth.users(id) on delete set null,
  reason text not null,
  detail text not null default '',
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  admin_note text not null default '',
  resolved_by_user_id uuid null references auth.users(id) on delete set null,
  resolved_at timestamptz null,
  created_at timestamptz not null default timezone('utc', now()),
  check (
    (entry_id is not null and comment_id is null)
    or (entry_id is null and comment_id is not null)
  )
);

create index if not exists idx_community_fit_room_entries_visible
  on public.community_fit_room_entries(expires_at desc, created_at desc)
  where deleted_at is null;

create index if not exists idx_community_fit_room_entries_user_created
  on public.community_fit_room_entries(user_id, created_at desc);

create index if not exists idx_community_fit_room_comments_entry_created
  on public.community_fit_room_comments(entry_id, created_at desc)
  where deleted_at is null;

create index if not exists idx_community_fit_room_comments_user_created
  on public.community_fit_room_comments(user_id, created_at desc);

create index if not exists idx_community_fit_room_reactions_user
  on public.community_fit_room_reactions(user_id, updated_at desc);

create unique index if not exists uq_community_fit_room_reports_entry_reporter
  on public.community_fit_room_reports(reporter_user_id, entry_id)
  where entry_id is not null;

create unique index if not exists uq_community_fit_room_reports_comment_reporter
  on public.community_fit_room_reports(reporter_user_id, comment_id)
  where comment_id is not null;

create index if not exists idx_community_fit_room_reports_status_created
  on public.community_fit_room_reports(status, created_at desc);

create index if not exists idx_community_fit_room_reports_target_user
  on public.community_fit_room_reports(target_user_id, created_at desc);

alter table public.community_fit_room_entries enable row level security;
alter table public.community_fit_room_comments enable row level security;
alter table public.community_fit_room_reactions enable row level security;
alter table public.community_fit_room_reports enable row level security;

commit;

notify pgrst, 'reload schema';
