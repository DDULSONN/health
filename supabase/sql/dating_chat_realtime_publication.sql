begin;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dating_chat_messages'
  ) then
    alter publication supabase_realtime add table public.dating_chat_messages;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'dating_chat_threads'
  ) then
    alter publication supabase_realtime add table public.dating_chat_threads;
  end if;
end $$;

commit;
