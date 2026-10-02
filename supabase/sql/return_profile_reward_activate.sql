-- Run AFTER return_profile_reward.sql, before the feature is released.
-- Freezes the cohort once. Does not grant any credits. Re-running never enrolls new members.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
select public.activate_return_profile_reward() as eligible_members;
commit;
