-- Store per-photo blurred paths for open cards so public APIs can avoid raw originals in blur mode.

begin;

alter table public.dating_cards
  add column if not exists blur_paths jsonb not null default '[]'::jsonb;

update public.dating_cards
set blur_paths = case
  when coalesce(blur_thumb_path, '') <> '' then jsonb_build_array(blur_thumb_path)
  else '[]'::jsonb
end
where blur_paths is null or blur_paths = '[]'::jsonb;

commit;

notify pgrst, 'reload schema';
