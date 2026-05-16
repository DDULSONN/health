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

alter table public.community_fit_room_entries enable row level security;
alter table public.community_fit_room_comments enable row level security;
alter table public.community_fit_room_reactions enable row level security;

commit;

notify pgrst, 'reload schema';
