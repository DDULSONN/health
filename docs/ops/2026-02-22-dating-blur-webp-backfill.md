# 2026-02-22: dating blur webp backfill (traffic hotfix)

## Summary
Emergency mitigation for helchang.com dating image egress spike:
- Converted legacy blur references to `.webp`
- Ensured blur objects are mirrored to `dating-card-lite` for `/i/public-lite/...` serving
- Updated DB references for `dating_cards` / `dating_paid_cards`

## Command Run
```bash
node scripts/backfill-dating-blur-webp.mjs --apply --concurrency=8
```

## Result
- doneJobs=324/324
- transformed=640
- privateExists=16
- publicExists=16
- fetchFail=0
- uploadFail=0
- dbUpdated=316
- dbUnchanged=8

## Quick Validation
- `GET /api/dating/cards/public?limit=20` sample had:
  - no `/i/signed/.../blur/...`
  - no `.jpg` in blur URLs
- image URL response headers:
  - `Content-Type: image/webp`
  - cache transitioned MISS -> HIT on repeated request

## Rollback
If urgent rollback is required (DB path rollback only):
```bash
# dry-run
node scripts/rollback-dating-blur-webp-paths.mjs

# apply
node scripts/rollback-dating-blur-webp-paths.mjs --apply
```

> Note: rollback script rewrites `/blur/*.webp` references back to `/blur/*.jpg` in DB fields.
