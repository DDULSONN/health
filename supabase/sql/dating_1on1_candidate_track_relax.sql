begin;

drop index if exists public.uq_dating_1on1_match_active_candidate_track;

commit;

notify pgrst, 'reload schema';
