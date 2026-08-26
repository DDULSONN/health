insert into public.site_settings (key, value_json)
values (
  'header_ad_banner',
  '{"enabled":false,"imageUrl":"","linkUrl":"","altText":"","startsAt":null,"expiresAt":null}'::jsonb
)
on conflict (key) do nothing;
