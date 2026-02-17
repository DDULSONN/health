-- Require instagram_id for dating applications
begin;

alter table public.dating_applications
add column if not exists instagram_id text;

-- Backfill existing rows so NOT NULL can be applied safely.
update public.dating_applications
set instagram_id = ''
where instagram_id is null;

alter table public.dating_applications
alter column instagram_id set not null;

commit;