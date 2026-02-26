-- Prevent duplicate active approvals per user + province.
create index if not exists idx_city_view_requests_approved_user_city_expires
  on public.dating_city_view_requests (user_id, city, access_expires_at)
  where status = 'approved';

create or replace function public.prevent_duplicate_active_city_view_approval()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'approved'
     and new.access_expires_at is not null
     and new.access_expires_at > now() then
    if exists (
      select 1
      from public.dating_city_view_requests r
      where r.user_id = new.user_id
        and r.city = new.city
        and r.status = 'approved'
        and r.access_expires_at is not null
        and r.access_expires_at > now()
        and r.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) then
      raise exception 'active approved request already exists for this user and city'
        using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_duplicate_active_city_view_approval on public.dating_city_view_requests;
create trigger trg_prevent_duplicate_active_city_view_approval
before insert or update of user_id, city, status, access_expires_at
on public.dating_city_view_requests
for each row
execute function public.prevent_duplicate_active_city_view_approval();

