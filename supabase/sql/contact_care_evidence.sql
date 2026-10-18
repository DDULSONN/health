-- Run after contact_care.sql, before activation. No public evidence URLs.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('contact-care-evidence','contact-care-evidence',false,1500000,array['image/webp'])
on conflict(id) do update set public=false,file_size_limit=1500000,allowed_mime_types=array['image/webp'];
-- Restrictive policy also protects this bucket if unrelated permissive policies exist.
drop policy if exists contact_care_private_only on storage.objects;
create policy contact_care_private_only on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'contact-care-evidence') with check(bucket_id<>'contact-care-evidence');

create or replace function public.cleanup_contact_care_uploads(p_admin uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
set lock_timeout='3s' set statement_timeout='5s' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where user_id=p_admin and role='admin' and not coalesce(is_banned,false)) then raise exception 'CARE_ADMIN'; end if;
  -- Mark first: submission locks the same row and refuses purging reservations.
  with targets as (
    select u.id from public.contact_care_uploads u
    where u.purging or not exists(select 1 from auth.users a where a.id=u.user_id and a.deleted_at is null)
      or (u.submitted_at is null and u.created_at<now()-interval '24 hours')
      or (u.created_at<now()-interval '30 days' and not exists(select 1 from public.contact_care_claims c
        where c.upload_id=u.id and (c.status in ('pending','needs_info') or c.reviewed_at>now()-interval '30 days')))
    order by u.created_at limit 20 for update skip locked
  ), marked as (update public.contact_care_uploads u set purging=true from targets t where u.id=t.id returning u.id,u.paths)
  select coalesce(jsonb_agg(to_jsonb(marked)),'[]'::jsonb) into result from marked;
  return result;
end;
$$;
create or replace function public.finish_contact_care_cleanup(p_admin uuid,p_upload uuid)
returns void language plpgsql security definer set search_path=pg_catalog as $$
begin
  if not exists(select 1 from public.profiles where user_id=p_admin and role='admin' and not coalesce(is_banned,false)) then raise exception 'CARE_ADMIN'; end if;
  delete from public.contact_care_uploads u where id=p_upload and purging
    and not exists(select 1 from storage.objects o where o.bucket_id='contact-care-evidence' and o.name=any(u.paths));
end;
$$;
revoke all on function public.cleanup_contact_care_uploads(uuid),public.finish_contact_care_cleanup(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cleanup_contact_care_uploads(uuid),public.finish_contact_care_cleanup(uuid,uuid) to service_role;
commit;
notify pgrst,'reload schema';
