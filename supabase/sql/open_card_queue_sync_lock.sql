begin;

-- A database-backed lease serializes queue syncs across serverless instances
-- and across the public-list, stats, received-list and cron entry points.
insert into public.site_settings (key, value_json, updated_at)
values (
  'open_card_queue_sync_lock',
  '{"initialized": true}'::jsonb,
  '1970-01-01 00:00:00+00'::timestamptz
)
on conflict (key) do nothing;

commit;

notify pgrst, 'reload schema';
