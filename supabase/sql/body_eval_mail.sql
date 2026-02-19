-- Body-eval mail system (thread + messages)
-- Scope: only for photo_bodycheck posts.

begin;

create table if not exists public.body_eval_mail_threads (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  unique (post_id, sender_id)
);

create index if not exists idx_body_eval_mail_threads_author_created
  on public.body_eval_mail_threads (author_id, created_at desc);
create index if not exists idx_body_eval_mail_threads_sender_created
  on public.body_eval_mail_threads (sender_id, created_at desc);

create table if not exists public.body_eval_mail_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.body_eval_mail_threads(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (length(content) between 1 and 2000),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_body_eval_mail_messages_thread_created
  on public.body_eval_mail_messages (thread_id, created_at asc);
create index if not exists idx_body_eval_mail_messages_receiver_unread
  on public.body_eval_mail_messages (receiver_id, is_read, created_at desc);
create index if not exists idx_body_eval_mail_messages_sender_created
  on public.body_eval_mail_messages (sender_id, created_at desc);

alter table public.body_eval_mail_threads enable row level security;
alter table public.body_eval_mail_messages enable row level security;

-- Threads: participant only
drop policy if exists "body_eval_mail_threads_select_participant" on public.body_eval_mail_threads;
create policy "body_eval_mail_threads_select_participant"
  on public.body_eval_mail_threads for select
  to authenticated
  using (auth.uid() in (author_id, sender_id));

drop policy if exists "body_eval_mail_threads_insert_sender_only" on public.body_eval_mail_threads;
create policy "body_eval_mail_threads_insert_sender_only"
  on public.body_eval_mail_threads for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> author_id
    and exists (
      select 1
      from public.posts p
      where p.id = post_id
        and p.user_id = author_id
        and p.type = 'photo_bodycheck'
        and coalesce(p.is_deleted, false) = false
    )
  );

drop policy if exists "body_eval_mail_threads_update_participant" on public.body_eval_mail_threads;
create policy "body_eval_mail_threads_update_participant"
  on public.body_eval_mail_threads for update
  to authenticated
  using (auth.uid() in (author_id, sender_id))
  with check (auth.uid() in (author_id, sender_id));

-- Messages: participant only
drop policy if exists "body_eval_mail_messages_select_participant" on public.body_eval_mail_messages;
create policy "body_eval_mail_messages_select_participant"
  on public.body_eval_mail_messages for select
  to authenticated
  using (auth.uid() in (sender_id, receiver_id));

drop policy if exists "body_eval_mail_messages_insert_participant" on public.body_eval_mail_messages;
create policy "body_eval_mail_messages_insert_participant"
  on public.body_eval_mail_messages for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> receiver_id
    and exists (
      select 1
      from public.body_eval_mail_threads t
      where t.id = thread_id
        and (
          (sender_id = t.author_id and receiver_id = t.sender_id)
          or (sender_id = t.sender_id and receiver_id = t.author_id)
        )
    )
  );

drop policy if exists "body_eval_mail_messages_update_read_receiver_only" on public.body_eval_mail_messages;
create policy "body_eval_mail_messages_update_read_receiver_only"
  on public.body_eval_mail_messages for update
  to authenticated
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

commit;

notify pgrst, 'reload schema';
