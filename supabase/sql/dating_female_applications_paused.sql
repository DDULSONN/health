-- Temporarily pause female dating applications at RLS layer.
begin;

drop policy if exists "dating_insert_own" on public.dating_applications;

create policy "dating_insert_own"
  on public.dating_applications for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and sex = 'male'
    and exists (
      select 1 from public.cert_requests cr
      where cr.user_id = auth.uid() and cr.status = 'approved'
    )
  );

commit;