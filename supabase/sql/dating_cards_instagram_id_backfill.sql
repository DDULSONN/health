-- Ensure dating_cards uses instagram_id consistently.
-- Steps:
-- 1) add instagram_id
-- 2) backfill from owner_instagram_id
-- 3) set NOT NULL (+ format check)
-- 4) reload PostgREST schema cache

begin;

alter table public.dating_cards
  add column if not exists instagram_id text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dating_cards'
      and column_name = 'owner_instagram_id'
  ) then
    execute $q$
      update public.dating_cards
      set instagram_id = coalesce(nullif(instagram_id, ''), owner_instagram_id)
      where coalesce(instagram_id, '') = ''
        and coalesce(owner_instagram_id, '') <> ''
    $q$;
  end if;
end $$;

update public.dating_cards
set instagram_id = ''
where instagram_id is null;

alter table public.dating_cards
  alter column instagram_id set not null;

alter table public.dating_cards
  drop constraint if exists dating_cards_instagram_id_check;

alter table public.dating_cards
  add constraint dating_cards_instagram_id_check
  check (instagram_id ~ '^[A-Za-z0-9._]{1,30}$');

-- Optional cleanup after verifying app no longer depends on owner_instagram_id:
-- alter table public.dating_cards drop column if exists owner_instagram_id;

commit;

notify pgrst, 'reload schema';
