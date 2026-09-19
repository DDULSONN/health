# Matching navigation and overview cleanup

## Scope

- Preserve the adjacent open-card / 1:1 selector: it intentionally promotes 1:1
  to open-card visitors. Ordinary users see their existing opposite-sex card tab
  beside 1:1; users allowed to switch sex keep both gender options. The entire row
  is unchanged from production. No audience or eligibility changes.
- Header, mobile menu and bottom 1:1 navigation lead to the home candidate tab.
  Existing /dating/1on1 URLs and edit links remain valid. Selected state follows
  the query string, including same-path navigation and history restoration.
- The 1:1 tab has one missing-profile CTA leading to the existing unified form.
  A valid account-scoped local draft changes its label to resume. The form still
  independently checks phone verification, availability and registration state.
- MyPage overview omits empty groups. Selecting a specific group still shows its
  empty state; non-empty groups, expired cards and historical records remain.
- Open-card detailed controls are in a disclosure. The top management action
  selects All, expands it, and scrolls to it, including from another filter.
- Empty quick-match details and its existing Plus offer remain available in the
  Quick filter. Support-credit balances remain visible in the overview.

No matching algorithm, API requests, quotas, contact exchange, photo pipeline,
database migration, price or payment operation is changed. Validation does not
mutate production member data or initiate payments.

## Automated validation

    node --test scripts/check-dating-navigation-ux.cjs
    node --test scripts/check-profile-ux.cjs scripts/check-dating-1on1-refresh-copy.cjs scripts/check-dating-1on1-recommendations.cjs scripts/check-auth-session-middleware.cjs
    npx tsc --noEmit --incremental false

Navigation tests render actual React markup without network access. They cover
header/bottom selection, query restoration, guest return URLs, missing/draft/
unverified-profile CTA labels, loading/error states, empty-vs-populated groups,
and compare all fetch expressions in touched pages/header against deployed
612fb1d. Next production build separately validates Suspense/prerendering.

## Browser regression checks

The browser check caught a real same-path navigation regression: passing
`history.state` to `replaceState` carries Next's `__NA` marker, which bypasses
its `useSearchParams` notification. Use `null` so Next copies internal state and
notifies observers itself. Adjacent tabs and bottom/header selection now agree.
The selected tab is also initialized from the query before the first effect, and
authentication loading takes precedence over the guest login invitation.

Local-only MyPage harness (run after building to reuse the actual CSS):

    node scripts/mypage-navigation-fixture.cjs

Open `http://127.0.0.1:3115/mypage?section=matching&fixture=populated`.
`fixture=empty` covers a new member; `fixture=error` injects one initial 503 and
then allows Retry to recover. Restart the harness to reset the injected failure.
It bundles the real MyPage component. Only auth, Next navigation/image/link and
unchanged lazy widgets are adapted; no environment files or real accounts are
loaded. All non-GET and external fetches are blocked and CSP restricts connections
to the local fixture origin. This harness is not a production route or bundle.

Browser checks at 390px and desktop widths cover the populated/empty states,
selected-filter refresh, Received -> Card management (All selected, disclosure
opened), visible management controls, loaded profile/support photos and lightbox,
and error -> Retry recovery without a false empty-overview message. Do not submit
payments or match responses to test presentation. These checks are not equivalent
to a physical-device payment, SMS or live-member end-to-end test.

Other pending phone-verification/payment edits in the working tree are unrelated
and must not be bundled into this UI patch. The isolated build excludes them.
