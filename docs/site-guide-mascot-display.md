# Uploaded mascot display repair

## Reproduced failure
- The saved uploaded autumn mascot is an intact WebP in the private community bucket.
- Fetching its existing application image-proxy URL returns 200 and a decodable image.
- Passing the same URL (including its version query) through Next.js image optimization returns 400: the URL parameter is not allowed.
- The installed build's default image localPatterns only allow URLs without search parameters.

## Scoped repair
- The guide bubble displays already-optimized uploaded mascot WebPs directly from the existing application image proxy.
- Default WebP delivery stays direct; built-in summer and rain images keep their existing optimization behavior.
- Image-load errors fall back to the local default mascot. If the default itself fails, no source-change/retry loop is introduced.
- No global optimizer allowlist, storage bucket permission, profile photo access rule or production mascot selection is changed.

## Verification
- Run `node --test scripts/check-site-guide-mascot.cjs scripts/check-vercel-cost-cleanup.cjs`.
- The tests extract and render the actual guide image JSX, check source/srcset delivery and exercise the real error handler for all four mascot cases.
- The versioned uploaded-mascot case failed before this fix and passes after it.
- Also run a clean production build and request the rendered image URL locally using the saved production mascot as read-only input.
