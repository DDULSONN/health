insert into public.site_settings (key, value_json)
values (
  'tools_patch_note',
  '{"enabled": false, "text": ""}'::jsonb
)
on conflict (key) do nothing;
