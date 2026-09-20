# 1:1 recommendation repetition and refresh safety

## Scope

Base: `252527e2c8426ce11dde040e19a4a27216c99aaa`.
Isolated branch: `codex/recommendation-repeat-safety`. No deployment or production writes in this investigation.

The shared recommendation code can affect accounts other than the reported member. This does not establish that every member saw a bug: when the compatible local pool is small, some repetition is intentional and preferable to arbitrarily distant candidates.

## Findings and changes

- Handled-pair history and recently shown history were combined. Once the unhandled pool ran out, older pages could return too early despite comparable, not-recently-shown profiles remaining. Preserve those distinctions when replaying the bounded history.
- Extra candidates were sorted independently, so highly ranked extras could stay unchanged. Replay their previous pages and prefer unseen alternatives within the same compatibility tier. Main selection also considers earlier extra exposure; moving an extra into the main list still counts as a repeat.
- Historically skipped, canceled and expired pairs were permanently removed from extras, even though already eligible for the main list. Allow them back into extras after seven days; recent history remains a soft ranking penalty in main. Permanent rejections, active matches, bans, withdrawals, favorites and every block remain excluded as before.
- The home reload callback swallowed a failed GET after a successful refresh POST. This allowed an old screen plus a success message. Both surfaces now require a committed GET before announcing success, prevent concurrent clicks, and offer a GET-only reload after an ambiguous/failed response. This bug was reproduced offline; no historical network logs establish that it occurred for the reported account.
- No SQL/schema, refresh allowance, payment, phone verification, contact-disclosure, selection, or photo-hydration changes. No new database query. Geography metadata remains request-local, calculated once per candidate during replay.

## Verification

- 240 offline tests passed with no skips: recommendation API/ranking, real UI callbacks, refresh copy, age/privacy boundaries, profile UX and contact/payment recovery. Includes double clicks, failed/malformed POST/GET, small pools, both sexes, midnight, 24-hour expiry, recent-history boundaries and main/extra overlap.
- Existing one-time recovery SQL passed four isolated PostgreSQL assertions: eligibility, idempotence, private permissions and account/profile recreation safety. SQL was not changed or executed against production.
- Production build (`next build --webpack`) and targeted lint passed. Existing middleware/Browserslist warnings remain.
- Read-only production-data replay across 12 demographic/region cohorts: no entire 10-person main page stayed unchanged; no account with at least 10 compatible locals was sent fewer than 10 compatible locals. This is a sample, not a census or a record of what users actually saw. Invalid/banned/withdrawn source accounts are excluded from representative selection.
- Reported member's final snapshot: 508 eligible candidates, 149 compatible within 90 km. Simulated next refresh: main overlap 0/10, extras overlap 0/3, all 13 compatible and within 90 km. Query count 35, unchanged. The pool can change during live investigation; earlier snapshots were 509/150.
- Small-pool example: only 12 local/age-compatible people means two 10-person pages necessarily overlap by at least 8. The patch does not promise zero repetition or broaden location/age preferences to manufacture novelty.

## Deployment / limits

No account was refreshed, granted extra quota, messaged, charged or otherwise mutated. GitHub/production deployment is a separate next step. Normal GETs reconstruct ranking from existing refresh events; they do not persist impressions or guarantee exact historical reconstruction as profile eligibility changes. No unconditional client retries of the refresh POST were added.

Run checks:

```powershell
node --test scripts/check-dating-1on1-recommendations.cjs scripts/check-recommendation-refresh-ui.cjs scripts/check-profile-ux.cjs scripts/check-dating-1on1-refresh-copy.cjs scripts/check-dating-age.cjs scripts/check-contact-payment-conversion.cjs
# Optional local-only PostgreSQL regression: set PRIVACY_TEST_PGLITE_PATH to an installed @electric-sql/pglite entry point.
node scripts/check-dating-1on1-recovery-once.cjs
# Production audit uses GET/HEAD only and requires credentials supplied outside source control.
node scripts/audit-recommendation-cohorts.cjs
```
