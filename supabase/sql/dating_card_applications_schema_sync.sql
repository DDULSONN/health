-- Ensure dating_card_applications has columns used by open-card apply API.

begin;

alter table public.dating_card_applications
  add column if not exists applicant_display_nickname text not null default '';

alter table public.dating_card_applications
  add column if not exists intro_text text not null default '';

-- Prefer new column name used by API.
alter table public.dating_card_applications
  add column if not exists photo_paths jsonb not null default '[]'::jsonb;

-- Backfill photo_paths from legacy photo_urls if present.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dating_card_applications'
      and column_name = 'photo_urls'
  ) then
    execute $q$
      update public.dating_card_applications
      set photo_paths = coalesce(photo_paths, photo_urls, '[]'::jsonb)
      where photo_paths is null
         or photo_paths = '[]'::jsonb
    $q$;
  end if;
end $$;

alter table public.dating_card_applications
  alter column applicant_display_nickname set not null,
  alter column applicant_display_nickname set default '',
  alter column intro_text set not null,
  alter column photo_paths set not null,
  alter column photo_paths set default '[]'::jsonb;

commit;

notify pgrst, 'reload schema';
