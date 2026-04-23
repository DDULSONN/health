begin;

create table if not exists public.dating_chat_threads (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('open', 'paid', 'swipe')),
  source_id uuid not null,
  user_a_id uuid not null references auth.users(id) on delete cascade,
  user_b_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  user_a_hidden_at timestamptz,
  user_b_hidden_at timestamptz,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dating_chat_threads_no_self check (user_a_id <> user_b_id),
  unique (source_kind, source_id)
);

alter table public.dating_chat_threads
  add column if not exists user_a_hidden_at timestamptz,
  add column if not exists user_b_hidden_at timestamptz;

create index if not exists idx_dating_chat_threads_user_a
  on public.dating_chat_threads (user_a_id, coalesce(last_message_at, created_at) desc);

create index if not exists idx_dating_chat_threads_user_b
  on public.dating_chat_threads (user_b_id, coalesce(last_message_at, created_at) desc);

create table if not exists public.dating_chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.dating_chat_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint dating_chat_messages_no_self check (sender_id <> receiver_id)
);

create index if not exists idx_dating_chat_messages_thread_created
  on public.dating_chat_messages (thread_id, created_at asc);

create index if not exists idx_dating_chat_messages_receiver_unread
  on public.dating_chat_messages (receiver_id, is_read, created_at desc);

create table if not exists public.dating_chat_reports (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  source_kind text not null check (source_kind in ('open', 'paid', 'swipe')),
  source_id uuid not null,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 1 and 120),
  details text,
  conversation_excerpt jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references auth.users(id) on delete set null,
  constraint dating_chat_reports_no_self check (reporter_user_id <> reported_user_id),
  unique (thread_id, reporter_user_id)
);

create index if not exists idx_dating_chat_reports_status_created
  on public.dating_chat_reports (status, created_at desc);

create index if not exists idx_dating_chat_reports_reported_user
  on public.dating_chat_reports (reported_user_id, created_at desc);

alter table public.dating_chat_threads enable row level security;
alter table public.dating_chat_messages enable row level security;
alter table public.dating_chat_reports enable row level security;

drop policy if exists "dating_chat_threads_select_participant" on public.dating_chat_threads;
create policy "dating_chat_threads_select_participant"
  on public.dating_chat_threads for select
  to authenticated
  using (auth.uid() in (user_a_id, user_b_id));

drop policy if exists "dating_chat_threads_insert_participant" on public.dating_chat_threads;
create policy "dating_chat_threads_insert_participant"
  on public.dating_chat_threads for insert
  to authenticated
  with check (auth.uid() in (user_a_id, user_b_id));

drop policy if exists "dating_chat_threads_update_participant" on public.dating_chat_threads;
create policy "dating_chat_threads_update_participant"
  on public.dating_chat_threads for update
  to authenticated
  using (auth.uid() in (user_a_id, user_b_id))
  with check (auth.uid() in (user_a_id, user_b_id));

drop policy if exists "dating_chat_messages_select_participant" on public.dating_chat_messages;
create policy "dating_chat_messages_select_participant"
  on public.dating_chat_messages for select
  to authenticated
  using (auth.uid() in (sender_id, receiver_id));

drop policy if exists "dating_chat_messages_insert_sender" on public.dating_chat_messages;
create policy "dating_chat_messages_insert_sender"
  on public.dating_chat_messages for insert
  to authenticated
  with check (auth.uid() = sender_id);

drop policy if exists "dating_chat_messages_update_receiver" on public.dating_chat_messages;
create policy "dating_chat_messages_update_receiver"
  on public.dating_chat_messages for update
  to authenticated
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

drop policy if exists "dating_chat_reports_insert_reporter" on public.dating_chat_reports;
create policy "dating_chat_reports_insert_reporter"
  on public.dating_chat_reports for insert
  to authenticated
  with check (auth.uid() = reporter_user_id);

commit;

notify pgrst, 'reload schema';
