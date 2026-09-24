# Profile writing and resume UX

Local patch based on `185a0e8`. No database migration or production data changes.

## Scope

- Keep all existing introduction fields and required/minimum/maximum validation.
- Add short prompts and manually expandable examples. Examples never fill or submit the form.
- Show a compact resume prompt on the home matching tabs for the authenticated member's valid, non-empty local draft, only when at least one selected service is not registered yet.
- Reuse existing profile-presence requests and seven-day, account-scoped draft storage. No new API, polling, schema or storage format.
- Auth changes invalidate the prompt; denied storage, expired drafts and failed profile-status reads do not block the page.
- Photo upload, consent, draft restoration, registration, phone verification, matching and payment handlers are unchanged.

## Local preview

After a production build has produced `.next/static/css`, run `npm run preview:profile-writing`.

- Home: `http://127.0.0.1:3138/community/dating/cards?tab=one_on_one&preview=resume`
- Form: `http://127.0.0.1:3138/onboarding/dating?preview=resume`, then choose the existing resume button.

This fixture renders the actual page components with a synthetic member and local-only API responses. It omits the global header/footer. It loads no credentials and permits no real registration, uploads, SMS or purchases. `preview=resume` resets only the localhost synthetic draft.

## Verification

- `npm run check:profile-writing`: 17 unit and unchanged-scope checks.
- `npm run check:profile-writing-browser`: 18 checks on actual components, including 360/1280 px layout, Korean text, examples, validation/focus, account/expiry/storage isolation and no added requests from draft updates.
- Existing `scripts/check-profile-ux-browser.cjs`: registration, partial success, retries, draft recovery, photos, consent and bootstrap-failure regression checks.
- `npm run check:1on1-refresh-safety`: 326 existing regression checks.
- `npm run check:1on1-refresh-browser`: 16 home/mypage browser cases.
- Production build and scoped ESLint. Existing home warnings are unrelated to this patch.

Browser tests use Edge and the configured Playwright runtime; override `CODEX_NODE_PACKAGES` if necessary. These are mocked local browser regressions, not real member signups or production payments. Conversion improvement must be measured after release; the UI change alone does not prove the cause of drop-off.
