insert into public.site_settings (key, value_json)
values (
  'employment_company_directory',
  '{"version":1,"companies":[]}'::jsonb
)
on conflict (key) do nothing;
