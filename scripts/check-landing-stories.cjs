/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const mod = { exports: {} };
new Function('exports', ts.transpileModule(read('lib/landing-reviews.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports);
const { LANDING_REVIEWS, FEATURED_LANDING_REVIEWS } = mod.exports;

test('featured excerpts retain the exact reviewed source and no invented identity or success claims', () => {
  assert.deepEqual(FEATURED_LANDING_REVIEWS.map(x => [x.review.src, x.quote]), [
    ['/landing/reviews/review-08.webp', '마음에 맞는 사람을 만나게 됐습니다!!'],
    ['/landing/reviews/review-04.webp', '첨엔 조금 걱정했는데 좋은사람같아요!'],
    ['/landing/reviews/review-05.webp', '지방 살아도 이게 되네요 ㅠㅠ 지인들한테도 추천했어요 !!'],
  ]);
  for (const story of FEATURED_LANDING_REVIEWS) assert.ok(LANDING_REVIEWS.includes(story.review));
});

test('the primary signup path follows the reviews immediately and all existing routes stay intact', () => {
  const source = read('app/landing/page.tsx');
  assert.equal((source.match(/가입하고 프로필 만들기/g) || []).length, 1);
  assert.ok(source.indexOf('<LandingStories />') < source.indexOf('가입하고 프로필 만들기'));
  assert.ok(source.indexOf('가입하고 프로필 만들기') < source.indexOf('className={styles.heroBody}'));
  for (const url of ['/signup', '/login?tab=password&amp;next=%2Fonboarding%2Fdating', '/community/dating/cards']) assert.ok(source.includes(`href="${url}"`));
  assert.doesNotMatch(source, /무료|18,000|결제/);
});

test('review presentation does not call APIs, change membership or load screenshots before interaction', () => {
  const source = read('components/LandingStories.tsx');
  assert.doesNotMatch(source, /fetch\(|supabase|localStorage|sessionStorage|setInterval|requestAnimationFrame|<form|<input|type="submit"/);
  assert.match(source, /allOpen \? <div/); assert.match(source, /current \? failed/);
  assert.match(source, /LANDING_REVIEWS\.map/); assert.match(source, /loading="lazy"/);
  assert.match(source, /object-fit: contain/); assert.match(source, /onCancel=/);
  assert.match(source, /trigger\.focus/); assert.match(source, /previousOverflow/);
  assert.match(source, /noopener,noreferrer/); assert.match(source, /만남을 보장하지 않아요/);
  assert.doesNotMatch(source, /animation:|transition:|autoFocus/);
});
