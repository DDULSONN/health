/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');

// Reconstruct only the prior output of reviewed opt-in pass UI additions.
// Fixed baseline hashes elsewhere still catch every unrelated edit.
const navigation = [
  [
    '  const fromLovePass = searchParams.get("from") === "love-pass";\n' +
    '  const listHref = fromLovePass ? "/dating/love-pass" : fromNearby ? "/dating/nearby-view" : "/community/dating/cards";\n' +
    '  const sourceQuery = fromLovePass ? "?from=love-pass" : fromNearby ? "?from=nearby" : "";\n' +
    '  const detailHref = `/community/dating/cards/${id}${sourceQuery}`;\n',
    '  const listHref = fromNearby ? "/dating/nearby-view" : "/community/dating/cards";\n' +
    '  const detailHref = `/community/dating/cards/${id}${fromNearby ? "?from=nearby" : ""}`;\n',
  ],
];

const changes = {
  'app/community/dating/cards/page.tsx': [
    ['import LovePassLink from "@/components/dating/LovePassLink";\n', ''],
    ['      {showOpenCardSection && showMemberOffers ? <LovePassLink placement="open-card-home" /> : null}\n', ''],
    [
      '  const showMemberOffers = viewerSessionReady && viewerLoggedIn && !viewerSessionError;\n' +
      '  const hasLovePassQuickMatch = showMemberOffers && (swipeState.unlimitedPass === true || swipeSubscriptionStatus?.lovePassActive === true);\n' +
      '  const showSwipePlusOffer = showMemberOffers && !hasLovePassQuickMatch && swipeSubscriptionStatus !== null && !swipeSubscriptionLoading;\n',
      '  const hasLovePassQuickMatch = viewerLoggedIn && (swipeState.unlimitedPass === true || swipeSubscriptionStatus?.lovePassActive === true);\n' +
      '  const showSwipePlusOffer = viewerSessionReady && !hasLovePassQuickMatch && (!viewerLoggedIn || (swipeSubscriptionStatus !== null && !swipeSubscriptionLoading));\n',
    ],
    [
      '        {showMemberOffers ? <div className="mt-4 flex flex-wrap items-center gap-2">\n          {hasLovePassQuickMatch ? <>',
      '        <div className="mt-4 flex flex-wrap items-center gap-2">\n          {hasLovePassQuickMatch ? <>',
    ],
    [
      '        </div> : null}\n\n        {swipeRefreshing && !swipeLoading ?',
      '        </div>\n\n        {swipeRefreshing && !swipeLoading ?',
    ],
    ['  unlimitedPass?: boolean;\n', ''],
    ['          unlimitedPass: body.unlimitedPass === true,\n', ''],
    ['      if (action === "like" && swipeState.unlimitedPass && swipeState.remaining <= 0) return;\n', ''],
    [', swipeState.loggedIn, swipeState.unlimitedPass, swipeState.remaining, swipeSubmitting]', ', swipeState.loggedIn, swipeSubmitting]'],
    ['{swipeState.unlimitedPass ? `후보는 계속 볼 수 있어요. 좋아요는 하루 ${swipeState.limit}번까지예요.` : <>랜덤 후보를 하루 최대 {swipeState.limit}명까지 빠르게 확인할 수 있어요.</>}', '랜덤 후보를 하루 최대 {swipeState.limit}명까지 빠르게 확인할 수 있어요.'],
    ['{swipeState.unlimitedPass ? "오늘 남은 좋아요" : "오늘 남은"}', '오늘 남은'],
    ['disabled={swipeSubmitting || (swipeState.unlimitedPass === true && swipeState.remaining <= 0)}', 'disabled={swipeSubmitting}'],
  ],
  'app/community/dating/cards/[id]/page.tsx': [
    ...navigation,
    ['href={`/community/dating/cards/${card.id}/apply${sourceQuery}`}', 'href={`/community/dating/cards/${card.id}/apply${fromNearby ? "?from=nearby" : ""}`}'],
  ],
  'app/community/dating/cards/[id]/apply/page.tsx': [
    ...navigation,
    ['  const applyHref = `/community/dating/cards/${id}/apply${sourceQuery}`;', '  const applyHref = `/community/dating/cards/${id}/apply${fromNearby ? "?from=nearby" : ""}`;'],
  ],
};

function withoutLovePassCardView(source, file) {
  if (!Object.hasOwn(changes, file)) return source;
  source = source.replace(/\r\n/g, '\n');
  for (const [index, [current, previous]] of changes[file].entries()) {
    assert.equal(source.split(current).length, 2, `Exact reviewed Love Pass change ${index + 1}: ${file}`);
    source = source.replace(current, previous);
  }
  return source;
}

module.exports = { withoutLovePassCardView };
