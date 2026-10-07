/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mod = { exports: {} };
new Function('exports', ts.transpileModule(read('lib/landing-reviews.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(mod.exports);
const { LANDING_REVIEWS, SIGNUP_REVIEWS } = mod.exports;
test('signup reuses exactly three existing public WebPs under 90 KiB total', () => {
  assert.equal(SIGNUP_REVIEWS.length, 3); assert.equal(LANDING_REVIEWS.length, 10);
  let bytes = 0;
  for (const review of SIGNUP_REVIEWS) {
    assert.ok(LANDING_REVIEWS.includes(review));
    assert.match(review.src, /^\/landing\/reviews\/review-\d{2}\.webp$/);
    const data = fs.readFileSync(path.join(root, 'public', review.src));
    assert.equal(data.toString('ascii', 0, 4), 'RIFF'); assert.equal(data.toString('ascii', 8, 12), 'WEBP');
    assert.ok(review.width > 0 && review.height > 0); bytes += data.length;
  }
  assert.ok(bytes < 90 * 1024, `${bytes} exceeds image budget`);
});
test('all original landing reviews stay in the same order and remain duplicated for its rail', () => {
  assert.deepEqual(LANDING_REVIEWS.map(r => r.src), Array.from({ length: 10 }, (_, i) => `/landing/reviews/review-${String(i + 1).padStart(2, '0')}.webp`));
  const source = read('app/landing/page.tsx');
  assert.match(source, /LANDING_REVIEWS as reviewProofs/);
  assert.ok(source.includes('[...reviewProofs, ...reviewProofs]'));
});
test('signup stories render after login link, outside form, and only during the signup form state', () => {
  const source = read('app/signup/page.tsx');
  assert.match(source, /\{step === "form" && <SignupStories \/>\}/);
  assert.ok(source.indexOf('<SignupStories') > source.lastIndexOf('</Link>'));
  assert.ok(source.indexOf('<SignupStories') > source.lastIndexOf('</form>'));
});
test('stories never request member APIs, modify form data or introduce animation timers', () => {
  const source = read('components/SignupStories.tsx');
  assert.ok(!/fetch\(|supabase|localStorage|sessionStorage|setInterval|requestAnimationFrame|<form|<input/.test(source));
  assert.ok(!/type="submit"/.test(source));
  assert.match(source, /IntersectionObserver/); assert.match(source, /loading="lazy"/); assert.match(source, /fetchPriority="low"/);
  assert.match(source, /prefers-reduced-motion: reduce/); assert.match(source, /animation: none/);
  assert.match(source, /aria-hidden=\{duplicate/); assert.match(source, /tabIndex=\{duplicate \? -1 : 0\}/);
  assert.match(source, /object-fit: contain/);
});
