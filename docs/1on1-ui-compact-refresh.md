# 1:1 compact Plus and refresh UI

## Scope

- Active Plus members see a collapsed, 48px status row. Expiry is displayed in Korea time. Benefits remain available on expansion, including legacy contact-exchange inclusion.
- Non-Plus members retain their existing purchase offers and checkout handlers.
- Both home and My Page share the 44px refresh control, separate remaining-count label, collapsible policy, and HTML confirmation dialog.
- Cancel/Escape do not send a request. The confirmation shows before/after balance. Success appears inline only after the updated list is committed.
- Main, saved and extra candidate panels use neutral surfaces; candidate selection uses the site's pink accent. Photo markup and candidate ordering are unchanged.

## Safety boundaries

- No SQL, API, recommendation algorithm, refresh limit, age/region/block rule, payment or photo-access changes.
- Refresh still calls the same POST endpoint with only source_card_id. The server remains authoritative for eligibility and actual consumption.
- A synchronous per-card lock is acquired before the asynchronous confirmation. Repeated confirmation clicks settle the same promise only once.
- Unmount cancels unresolved confirmation. Network requests have a 30-second client timeout and no automatic retry.
- Ambiguous POST results or a failed subsequent read retain the existing GET-only recovery path. Users must reload the list before another refresh attempt.
- Production accounts and refresh allowances were not modified during verification.

## Verification

- Production webpack build: passed.
- Refresh/matching safety suite: 332 tests passed, including confirmation cancellation/unmount, stale responses, server rejection, invalid payloads, duplicate taps, age/region/block/contact checks and legacy entitlement.
- Isolated real-page browser tests: 40 scenarios passed in StrictMode, home/My Page, 360px/1280px. Includes cancel/reopen, Escape/reopen, duplicate clicks, slow POST, timeout, lost response, failed/malformed GET, free/Plus/legacy Plus, layout overflow and Korean text checks.
- Browser tests block external requests. Production requests: zero.
- Image proxy check and scoped lint: passed, with 12 pre-existing warnings in the large page files and no errors.
- Actual iPhone Safari/Samsung Internet device testing remains unperformed; browser tests used local Edge/Chromium.

## Release status

The full 332-test safety suite and 40 browser scenarios were rerun before release at the user's request.
This is a frontend-only release; no DB migration or production member mutation is required.
Generated public service-worker/workbox outputs are not source changes to include.
