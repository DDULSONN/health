/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const mod = { exports: {} };
new Function('exports', ts.transpileModule(read('lib/landing-reviews.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports);
const { LANDING_REVIEWS } = mod.exports;

test('all ten original screenshots are displayed directly, without replacement quotes or a collapsed gallery', () => {
  assert.equal(LANDING_REVIEWS.length, 10);
  for (const review of LANDING_REVIEWS) assert.ok(fs.existsSync(path.join(__dirname, '../public', review.src)));
  const source = read('components/LandingStories.tsx');
  assert.match(source, /LANDING_REVIEWS\.map/);
  assert.match(source, /<img src=\{review.src\}/);
  assert.doesNotMatch(source, /FEATURED_LANDING_REVIEWS|landing-stories-quote|allOpen|후기 더 보기/);
});

test('the primary signup path follows the reviews immediately and all existing routes stay intact', () => {
  const source = read('app/landing/page.tsx');
  assert.equal((source.match(/가입하고 프로필 만들기/g) || []).length, 1);
  assert.ok(source.indexOf('<LandingStories />') < source.indexOf('가입하고 프로필 만들기'));
  assert.ok(source.indexOf('가입하고 프로필 만들기') < source.indexOf('className={styles.heroBody}'));
  for (const url of ['/signup', '/login?tab=password&amp;next=%2Fonboarding%2Fdating', '/community/dating/cards']) assert.ok(source.includes(`href="${url}"`));
  assert.doesNotMatch(source, /무료|18,000|결제/);
});

test('review presentation preserves image ratios, accessible enlargement and motion controls without member API calls', () => {
  const source = read('components/LandingStories.tsx');
  assert.doesNotMatch(source, /fetch\(|supabase|localStorage|sessionStorage|setInterval|requestAnimationFrame|<form|<input|type="submit"/);
  assert.match(source, /current \? failed/);
  assert.match(source, /LANDING_REVIEWS\.map/); assert.match(source, /loading=\{index < 3 && !duplicate \? "eager" : "lazy"\}/);
  assert.match(source, /object-fit: contain/); assert.match(source, /onCancel=/);
  assert.match(source, /trigger\.focus/); assert.match(source, /previousOverflow/);
  assert.match(source, /noopener,noreferrer/); assert.match(source, /만남을 보장하지 않아요/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /aria-hidden=\{duplicate/);
  assert.match(source, /tabIndex=\{duplicate \? -1 : 0\}/);
  assert.match(source, /후기 자동 이동 일시정지/);
  assert.doesNotMatch(source, /autoFocus/);
});
