begin;

drop index if exists public.uq_dating_1on1_match_active_candidate_track;

create unique index if not exists uq_dating_1on1_match_active_candidate_track
  on public.dating_1on1_match_proposals (candidate_card_id)
  where state in ('source_selected', 'candidate_accepted');

commit;

notify pgrst, 'reload schema';
