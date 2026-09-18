# Profile UX safety checks

## Scope

- Component-local request coordination for 1:1 reads on home and mypage.
- Text-only local drafts for the unified form at /onboarding/dating.
- Field-level validation, error focus, and synchronous double-submit protection.
- No database migration, matching algorithm, refresh quota, contact exchange,
  payment, phone verification or upload pipeline change.
- No production member mutation is part of these tests.

## Request ordering

Non-mutating initial loads share an in-flight read. Reads after user actions force
a fresh request and invalidate earlier reads. Abort is best effort; a generation
check also rejects late results, errors and loading-state changes when the server
or a test transport ignores abort. Unmount/account changes cancel pending reads.
There is no cross-user cache, result TTL or automatic POST retry.

## Draft behavior

Drafts are account-scoped, retained for seven days in the same browser, and saved
after a 500 ms edit debounce or pagehide/hidden/unmount. Only an explicit allowlist
of editable text and choices is stored. Files, previews, upload paths, required
consents and server registration status are never restored from local storage.
The authenticated account, phone verification and current registration availability
are loaded before offering resume. Current saved nickname and server eligibility
take precedence. Completed registration clears the draft; partial failure preserves
the text and does not repeat successful registration during the same attempt.
Account switch/logout removes the draft. Storage denial does not block the form.

This is not cross-device sync. Photos and consents must be selected again.

## Repeatable offline checks

Run from the repository:

    node --test scripts/check-profile-ux.cjs scripts/check-dating-1on1-refresh-copy.cjs scripts/check-dating-1on1-recommendations.cjs
    node scripts/check-profile-ux-browser.cjs

The browser harness compiles the actual form and hooks with test-only auth/router/
API adapters, drives headless Edge via Playwright and retains screenshots in a
temporary directory. CODEX_NODE_PACKAGES can point to a different installed
Playwright runtime. PROFILE_UX_CSS_DIR optionally points to a built .next/static/css
directory for layout screenshots. Adapters are never imported by application code.

Coverage includes reversed response order, aborted transports, account isolation,
corrupted/expired/full storage, Korean reload before debounce, explicit discard,
mobile/desktop overflow, first-error focus, photo/consent reset, partial failure,
double click, successful cleanup and logout. Registration payloads and image
upload functions are compared against baseline b50e5d2.

Pre-publication recheck also covers each failed prerequisite endpoint, retry
without draft loss, ordinary same-account token renewal (no reload), verification/
instant-registration redirects and more than 1,000 validation-boundary comparisons
against the original form. Failed prerequisites show an explicit retry screen;
they never display the registered/completed state or enable submissions.

The browser harness does not prove real device storage policies or live network
behavior. Deployment should still be followed by a normal-account smoke test.
