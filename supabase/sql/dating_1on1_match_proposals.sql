begin;

create table if not exists public.dating_1on1_match_proposals (
  id uuid primary key default gen_random_uuid(),
  source_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  source_user_id uuid not null references auth.users(id) on delete cascade,
  candidate_card_id uuid not null references public.dating_1on1_cards(id) on delete cascade,
  candidate_user_id uuid not null references auth.users(id) on delete cascade,
  state text not null default 'proposed' check (
    state in (
      'proposed',
      'source_selected',
      'source_skipped',
      'candidate_accepted',
      'candidate_rejected',
      'source_declined',
      'admin_canceled',
      'mutual_accepted'
    )
  ),
  admin_sent_by_user_id uuid references auth.users(id) on delete set null,
  source_selected_at timestamptz,
  candidate_responded_at timestamptz,
  source_final_responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dating_1on1_match_no_self_pair check (source_card_id <> candidate_card_id),
  constraint dating_1on1_match_no_self_user check (source_user_id <> candidate_user_id)
);

create index if not exists idx_dating_1on1_match_proposals_source_card
  on public.dating_1on1_match_proposals (source_card_id, created_at desc);

create index if not exists idx_dating_1on1_match_proposals_candidate_card
  on public.dating_1on1_match_proposals (candidate_card_id, created_at desc);

create index if not exists idx_dating_1on1_match_proposals_source_user
  on public.dating_1on1_match_proposals (source_user_id, created_at desc);

create index if not exists idx_dating_1on1_match_proposals_candidate_user
  on public.dating_1on1_match_proposals (candidate_user_id, created_at desc);

create index if not exists idx_dating_1on1_match_proposals_state
  on public.dating_1on1_match_proposals (state, created_at desc);

create unique index if not exists uq_dating_1on1_match_active_pair
  on public.dating_1on1_match_proposals (source_card_id, candidate_card_id)
  where state in ('proposed', 'source_selected', 'candidate_accepted', 'mutual_accepted');

create unique index if not exists uq_dating_1on1_match_active_source_track
  on public.dating_1on1_match_proposals (source_card_id)
  where state in ('source_selected', 'candidate_accepted', 'mutual_accepted');

create unique index if not exists uq_dating_1on1_match_active_candidate_track
  on public.dating_1on1_match_proposals (candidate_card_id)
  where state in ('source_selected', 'candidate_accepted', 'mutual_accepted');

alter table public.dating_1on1_match_proposals enable row level security;

drop policy if exists "dating_1on1_match_admin_select" on public.dating_1on1_match_proposals;
create policy "dating_1on1_match_admin_select"
  on public.dating_1on1_match_proposals for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
    or auth.uid() = source_user_id
    or auth.uid() = candidate_user_id
  );

drop policy if exists "dating_1on1_match_admin_insert" on public.dating_1on1_match_proposals;
create policy "dating_1on1_match_admin_insert"
  on public.dating_1on1_match_proposals for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

drop policy if exists "dating_1on1_match_admin_update" on public.dating_1on1_match_proposals;
create policy "dating_1on1_match_admin_update"
  on public.dating_1on1_match_proposals for update
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

drop policy if exists "dating_1on1_match_admin_delete" on public.dating_1on1_match_proposals;
create policy "dating_1on1_match_admin_delete"
  on public.dating_1on1_match_proposals for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.user_id = auth.uid()
        and p.role = 'admin'
    )
  );

commit;

notify pgrst, 'reload schema';
