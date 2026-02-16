-- dating-photos storage bucket + policies
-- Run this in Supabase SQL editor if dating photo upload is denied.

begin;

insert into storage.buckets (id, name, public)
values ('dating-photos', 'dating-photos', false)
on conflict do nothing;

do $$ begin
  create policy "dating_photos_insert_own"
    on storage.objects
    for insert
    to authenticated
    with check (
      bucket_id = 'dating-photos'
      and auth.uid() is not null
      and auth.uid()::text = (storage.foldername(name))[2]
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "dating_photos_select_own"
    on storage.objects
    for select
    to authenticated
    using (
      bucket_id = 'dating-photos'
      and auth.uid()::text = (storage.foldername(name))[2]
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "dating_photos_update_own"
    on storage.objects
    for update
    to authenticated
    using (
      bucket_id = 'dating-photos'
      and auth.uid()::text = (storage.foldername(name))[2]
    )
    with check (
      bucket_id = 'dating-photos'
      and auth.uid()::text = (storage.foldername(name))[2]
    );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "dating_photos_delete_own"
    on storage.objects
    for delete
    to authenticated
    using (
      bucket_id = 'dating-photos'
      and auth.uid()::text = (storage.foldername(name))[2]
    );
exception when duplicate_object then null;
end $$;

commit;
