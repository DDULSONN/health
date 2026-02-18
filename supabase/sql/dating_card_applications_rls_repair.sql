-- Repair RLS policies for dating_card_applications to prevent 42501 on apply.

begin;

alter table public.dating_card_applications enable row level security;

-- Applicant can insert only own application to a public card owned by someone else.
drop policy if exists "dating_card_apps_applicant_insert" on public.dating_card_applications;
create policy "dating_card_apps_applicant_insert"
  on public.dating_card_applications for insert
  to authenticated
  with check (
    auth.uid() = applicant_user_id
    and exists (
      select 1
      from public.dating_cards c
      where c.id = card_id
        and c.status = 'public'
        and c.owner_user_id <> auth.uid()
    )
  );

-- Applicant can read own applications.
drop policy if exists "dating_card_apps_applicant_select" on public.dating_card_applications;
create policy "dating_card_apps_applicant_select"
  on public.dating_card_applications for select
  to authenticated
  using (auth.uid() = applicant_user_id);

-- Card owner can read applications to own card.
drop policy if exists "dating_card_apps_owner_select" on public.dating_card_applications;
create policy "dating_card_apps_owner_select"
  on public.dating_card_applications for select
  to authenticated
  using (
    exists (
      select 1
      from public.dating_cards c
      where c.id = card_id
        and c.owner_user_id = auth.uid()
    )
  );

-- Owner can accept/reject.
drop policy if exists "dating_card_apps_owner_update" on public.dating_card_applications;
create policy "dating_card_apps_owner_update"
  on public.dating_card_applications for update
  to authenticated
  using (
    exists (
      select 1
      from public.dating_cards c
      where c.id = card_id
        and c.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.dating_cards c
      where c.id = card_id
        and c.owner_user_id = auth.uid()
    )
    and status in ('accepted', 'rejected')
  );

commit;

notify pgrst, 'reload schema';
