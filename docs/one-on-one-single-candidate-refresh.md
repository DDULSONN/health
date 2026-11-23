# Single-slot 1:1 refresh

Only normal recommendations with a retained view receipt from before the
displayed generation offer a replacement. Additional candidates, saved
favorites and active matches do not. Eligibility is checked by member, not
profile revision, including archived cards already delivered in saved pages.
Search the remaining eligible pool by preferred-age fit and estimated region
distance, with distance-unknown results behind comparable measurable results.
Show an unseen person first. If all valid alternatives have been seen, revisit
an off-page person with a good fit, favoring an older view when fit is similar.
Never show the same member twice or recycle a slot already used in this
generation. A wide-region candidate is labeled; the current slot stays put
if no alternative qualifies. Normal full-page refresh keeps its separate
off-page selection and quota rules.

Missing photos or outdated profiles do not end the search at the first batch.
Use a lightweight photo check before loading candidate details and a bounded
request budget; a timeout is not proof that the pool is exhausted. The system
cannot reconstruct impressions from before recording was enabled or after the
retention window has elapsed.

The new operation stores one overlay and never writes the full recommendation
page, refresh usage, bonus usage, matching, payment or contact information.
There is a separate rolling 24-hour limit. Full-page refresh and one-slot
replacement share a database check so an intervening swap cannot be charged
as a new page. Concurrent writes fail closed, and
an absent candidate is a read-only result. The client reloads the canonical
recommendation list after success or an uncertain response without replaying
the mutation.

When a member is waiting for a new candidate, the visible 1:1 view periodically
checks live eligibility. The no-store probe returns only whether there is a
genuinely unseen person to see; repeat fallback does not trigger it. A
short-lived signed receipt lets it also notice a newly
eligible profile that the canonical list already added. Neither check swaps
a card, records an impression, opens a match, or exposes candidate details.
The first check is after about three minutes. Checks slow down while the pool
is empty, pause when the view is hidden or offline, and stop once something is
available or the viewed generation no longer matches.

## Rollout

1. Apply the additive `supabase/sql/dating_1on1_single_candidate_swaps.sql`
   migration after the existing impression, page and hide/block migrations.
   It adds a table and service-only operation; it does not update old rows.
2. Apply the additive `supabase/sql/dating_1on1_single_candidate_fallback.sql`
   migration. It adds a service-only fallback function; the original table
   and normal refresh/strict unseen functions remain unchanged.
3. Deploy the application. A missing fallback function disables only the
   revisit path. Keep the read-side overlay handling if rolling back a release
   after wide-region swaps have already been written; an older strict-only
   reader may omit such a slot until its generation changes.
4. Verify with synthetic eligible records only: correct slot, unseen preference,
   honest repeat-fallback copy, actually exhausted pool, unchanged normal/bonus
   counts, failure without a write, and account isolation.
