# Open Card photo privacy rollout

- A missing blur never falls back to the unblurred image. New unblurred
  derivatives stay private. Photo proxy responses that depend on permission are
  not cached by the CDN, the browser, or the site's service worker.
- No database migration is required for the application fix. After deployment,
  verify both authorized and denied image requests with test accounts before
  treating the rollout as complete. Separate production settings or storage
  changes are not part of running the test suite.
- Before this fix some unblurred derivatives were mirrored to a public bucket.
  Deploying the app does not revoke copied URLs or purge already-cached
  responses. Inventory those objects and verify that private equivalents are
  available before revoking the legacy copies and reviewing CDN cache handling.
  Preserve actual blurred assets and do not run the old public-lite backfill
  against production until it follows the new policy.
