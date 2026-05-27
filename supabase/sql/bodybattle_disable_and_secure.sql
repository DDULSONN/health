begin;

-- BodyBattle is retired. Keep existing data, but close direct public API access.
alter table if exists public.bodybattle_admin_runs enable row level security;
revoke all on table public.bodybattle_admin_runs from anon, authenticated;

revoke execute on function public.increment_bodybattle_exposures_safe(uuid) from public, anon, authenticated;
revoke execute on function public.bodybattle_cast_vote(uuid, uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.bodybattle_finalize_season(uuid) from public, authenticated;
revoke execute on function public.bodybattle_ensure_current_season() from public, authenticated;
revoke execute on function public.bodybattle_finalize_due_seasons() from public, authenticated;
revoke execute on function public.bodybattle_claim_reward(uuid, text) from public, authenticated;

commit;
