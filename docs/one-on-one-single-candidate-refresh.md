# Single-slot 1:1 refresh

Only normal recommendations with a retained view receipt from before the
displayed generation offer a replacement. Additional candidates, saved
favorites and active matches do not. Eligibility is checked by member, not
profile revision, including archived cards already delivered in saved pages.
The existing age preference stays in force. Candidates are ranked from the
shortest estimated distance, widening past 90 km only if no closer profile
can still be shown, up to 180 km. Widened matches display a region notice.
Missing photos or outdated profiles do not end the search at the first batch.
The system cannot reconstruct impressions from
before recording was enabled or after the retention window has elapsed.

The new operation stores one overlay and never writes the full recommendation
page, refresh usage, bonus usage, matching, payment or contact information.
There is a separate rolling 24-hour limit. Full-page refresh and one-slot
replacement share a database check so an intervening swap cannot be charged
as a new page. Concurrent writes fail closed, and
an absent candidate is a read-only result. The client reloads the canonical
recommendation list after success or an uncertain response without replaying
the mutation.

## Rollout

1. Apply the additive `supabase/sql/dating_1on1_single_candidate_swaps.sql`
   migration after the existing impression, page and hide/block migrations.
   It adds a table and service-only operation; it does not update old rows.
2. Deploy the application. Without the new table the existing recommendation
   reads continue and the button is not offered. Roll back the application
   before any later schema cleanup; the original recommendations remain intact.
3. Verify with synthetic eligible records only: correct slot, new candidate,
   unchanged normal/bonus counts, failure without a write, and account isolation.
