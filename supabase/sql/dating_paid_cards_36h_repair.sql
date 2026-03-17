-- Repair legacy paid dating cards that were approved with ~24h duration
-- instead of the current 36h duration.
--
-- Safe scope:
-- - approved cards only
-- - active cards only
-- - rows where expires_at - paid_at is roughly 24h
--
-- Usage:
-- 1. Run the preview SELECT first and confirm the target rows.
-- 2. Then run the UPDATE section.

begin;

-- Preview target rows before update.
select
  id,
  user_id,
  nickname,
  status,
  paid_at,
  expires_at,
  expires_at - paid_at as original_duration,
  paid_at + interval '36 hours' as repaired_expires_at
from public.dating_paid_cards
where status = 'approved'
  and paid_at is not null
  and expires_at is not null
  and expires_at > now()
  and expires_at - paid_at between interval '23 hours' and interval '25 hours'
order by paid_at asc;

-- Apply repair.
with target_rows as (
  select
    id,
    paid_at,
    expires_at as old_expires_at
  from public.dating_paid_cards
  where status = 'approved'
    and paid_at is not null
    and expires_at is not null
    and expires_at > now()
    and expires_at - paid_at between interval '23 hours' and interval '25 hours'
)
update public.dating_paid_cards as cards
set expires_at = target_rows.paid_at + interval '36 hours'
from target_rows
where cards.id = target_rows.id
returning
  cards.id,
  cards.user_id,
  cards.nickname,
  target_rows.old_expires_at,
  cards.expires_at as new_expires_at,
  cards.expires_at - target_rows.paid_at as new_duration;

commit;
