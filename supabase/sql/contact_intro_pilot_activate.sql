-- RUN ONLY AFTER contact_intro_pilot.sql AND the new app release are verified.
-- This is the one-time activation (not a cron): starts 48 hours NOW, randomly
-- assigns at most 10 eligible, non-overlapping pairs. Re-running cannot extend
-- the campaign or refill slots. A zero-target result starts nothing.
-- Web/Toss only: 20,000 -> 15,000 KRW (25%). No SMS/email or automatic charges.
select public.activate_contact_intro_pilot();

-- Aggregate verification; does not expose phone numbers, emails or names.
select c.starts_at,c.expires_at,c.stopped_at,
  (select count(*) from public.contact_intro_offers) as assigned_pairs,
  (select count(*) from public.contact_intro_members) as assigned_members,
  (select count(distinct o.product_ref_id) from public.toss_test_payment_orders o
    join public.contact_intro_attempts a on a.order_id=o.id where o.status='paid') as paid_pairs,
  (select coalesce(sum(o.amount),0) from public.toss_test_payment_orders o
    join public.contact_intro_attempts a on a.order_id=o.id where o.status='paid') as paid_amount
from public.contact_intro_campaign c;

-- EMERGENCY: disable NEW discount orders only (uncomment if needed).
-- Existing orders/approved payments/phone exchange must not be deleted/repriced.
-- Pre-deadline reservations retain their price for recovery/retry, including a
-- provider-confirmed ABORTED/EXPIRED attempt. No new pairs/first orders are added.
-- update public.contact_intro_campaign set stopped_at=coalesce(stopped_at,now()) where id;
-- Do NOT delete campaign/offers/attempts or drop the insert guard for rollback.
