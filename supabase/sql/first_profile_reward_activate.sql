-- Run only after first_profile_reward.sql is installed and release is ready.
-- Re-running does not enroll additional users, grant credits, or restart the offer.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
select public.activate_first_profile_reward() as eligible_members;
commit;
