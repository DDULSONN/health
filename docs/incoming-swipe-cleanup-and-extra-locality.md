# Received-like cleanup and extra candidate locality (2026-10-04)

## Scope

- Received quick-match likes now have a compact **삭제** action. Confirmation explicitly says it removes the entry from the receiver's list only, not a profile, block, or existing mutual match.
- A private, versioned dismissal table persists cleanup across reloads/devices. The source swipe remains untouched: sender history, usage, mutual matches, chat, phone exchange and payments are not changed.
- The receiver-only API checks authentication, origin, swipe ownership, like action and exact timestamp. Repeated requests are idempotent. A new like/version is not suppressed by an earlier dismissal, including out-of-order saves.
- Hidden/missing target profiles are no longer offered an actionable like-back button. If the target hides while the page is open, the existing 410 guard still applies and the receiver view refreshes.
- Only the latest status response can update the page. A pre-deletion response cannot restore the deleted entry.

## Database rollout

Apply `supabase/sql/dating_swipe_incoming_dismissals.sql` once in the project SQL Editor. It only creates a private table, enables RLS, and grants server-only select/insert. It does not modify existing user/swipe/match rows.

The application tolerates the table not being installed: lists continue working and the delete action stays hidden. Do not claim the live deletion feature is enabled until the migration is applied and verified. Deleting the original swipe or account cascades its private dismissal records.

## Recommendation correction

Previously extra candidates excluded the accumulated main-page history as if it were a safety prohibition. With 15 suitable local people, a refresh could exhaust that history and choose remote extras even though five locals were absent from the current ten.

The correction keeps current main/extra lists disjoint, respects age and all existing blocked/rejected/active-pair/favorite eligibility filters, and treats previous exposure as a soft preference **within the same relevance tier**. Existing extras remain stable inside that tier on ordinary reads. Compatible local people precede distant unseen people.

No added recommendation database query, refresh event, quota change, match reset, phone disclosure or payment mutation. Existing accounts receive the correction on the next normal candidate GET. Small local pools can still overlap on refresh; we do not sacrifice suitability to promise zero repeats.

An acknowledgement-once site notice explains this precise correction for a fixed 48-hour release window; no email/SMS/inbox broadcast.

## Checks

- `node --test scripts/check-incoming-swipe-dismissals.cjs`: real API handlers with auth/ownership/missing-schema/hidden-target/failure/version/mutual-match cases; isolated PostgreSQL checks actual schema, privileges and cascade.
- `node scripts/check-incoming-swipe-browser.cjs`: actual MyPage with local fake APIs, mobile/desktop, confirmation cancel, retry, double-click, reload persistence, hidden target and missing schema.
- `node --test scripts/check-dating-1on1-recommendations.cjs scripts/check-site-announcement.cjs`: reproduces the historical-local exclusion bug and guards age/location/blocks/current-page uniqueness/stability, plus notice expiry.
- `npm run build`: critical unit/SQL gate, compile, type checks.
- Read-only operational replay before/after across 12 cohorts; no real member refresh POST or live match/payment changes.

Revenue audit is separate read-only diagnostics. Its aggregates distinguish full days from same-elapsed-time periods, paid amounts from unfinished orders, and product exposure from actual traffic. A revenue decline alone is not evidence of a payment outage, nor does a recommendation correction prove its revenue impact.
