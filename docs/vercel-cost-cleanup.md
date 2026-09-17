# Vercel cost cleanup: retired cron and default mascot

## Scope
- Remove only `/api/cron/bodybattle-season` from `vercel.json`. All 12 other schedules remain unchanged.
- Keep the retired endpoint and middleware's 410 response for existing callers.
- Use `public/mascot/jimnyang-guide-v2.webp` for the default mascot in the public setting, guide bubble, home fallbacks and admin/mypage fallbacks.
- Retain the original PNG for compatibility with old clients and cached responses.
- Bypass Next.js image transformations for the already-optimized default asset. The subsequent mascot display fix also bypasses transformations for administrator-uploaded WebP mascots, whose versioned URLs are otherwise rejected by the image optimizer. Built-in seasonal images keep their existing behavior.
- No matching, payment, authentication, notification or database changes.

## Asset
The WebP is a deterministic conversion of the original PNG, not a regenerated illustration.
It keeps the same 2:3 composition and alpha channel, at 512 x 768 pixels (sufficient for the 112px-wide guide bubble at high pixel density).
Generated with the installed Sharp library: `resize({ width: 512, withoutEnlargement: true }).webp({ quality: 85, alphaQuality: 100, effort: 6 })`.

## Verification
Run `node --test scripts/check-vercel-cost-cleanup.cjs`.
Checks cover all remaining cron schedules, the retired endpoint, all default image references, existing and custom mascot settings, image dimensions/alpha, byte budget and decoded pixel error.
Run a clean production build and verify that both the new WebP and compatibility PNG are served successfully.

The schedule change takes effect only after a production deployment. Removing the hourly job avoids 720 scheduled requests per 30 days; this is a request count, not a monetary saving estimate.
