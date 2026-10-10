/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const mod = { exports: {} };
new Function('exports', ts.transpileModule(read('lib/signup-verification.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(mod.exports);
const h = mod.exports;
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function init() { global.window = { localStorage: storage(), sessionStorage: storage() }; }
test('unavailable browser storage never turns successful signup or OAuth into failure', () => {
  global.window = {};
  for (const type of ['localStorage', 'sessionStorage']) Object.defineProperty(window, type, { get() { throw Error('blocked'); } });
  assert.equal(h.readSignupEmail(), ''); assert.equal(h.readPendingSignup(), null);
  assert.doesNotThrow(() => h.rememberSignupEmail('test@example.invalid'));
  assert.doesNotThrow(() => h.rememberSignupReferral('ABCDEFGH'));
  assert.doesNotThrow(() => h.rememberSignupReferral(''));
  assert.doesNotThrow(() => h.savePendingSignup(h.newPendingSignup('test@example.invalid', '')));
  assert.doesNotThrow(() => h.clearPendingSignup());
});
test('waiting state restores email/referral/deadline without passwords or arbitrary fields', () => {
  init(); const now = 100000, value = h.newPendingSignup('test@example.invalid', 'ABCDEFGH', now);
  h.savePendingSignup({ ...value, password: 'must-not-restore' });
  assert.deepEqual(h.readPendingSignup(now + 1000), value);
  h.clearPendingSignup(); assert.equal(h.readPendingSignup(now), null);
});
test('malformed, expired, future and excessive cooldown hints are ignored', () => {
  init(); const now = 1e9, valid = h.newPendingSignup('test@example.invalid', '', now);
  for (const bad of [null, [], {}, { ...valid, email: 'broken' }, { ...valid, email: 'x'.repeat(321) + '@x.test' },
    { ...valid, referralCode: '<script>' }, { ...valid, createdAt: now + 1 },
    { ...valid, createdAt: now - 86400000 }, { ...valid, createdAt: '100' },
    { ...valid, resendAvailableAt: now - 1 }, { ...valid, resendAvailableAt: now + 60001 }]) {
    window.sessionStorage.setItem(h.PENDING_SIGNUP_KEY, JSON.stringify(bad));
    assert.equal(h.readPendingSignup(now), null);
  }
  window.sessionStorage.setItem(h.PENDING_SIGNUP_KEY, '{bad'); assert.equal(h.readPendingSignup(now), null);
});
test('cooldown follows real elapsed time, including suspended/background tabs', () => {
  assert.equal(h.resendSecondsLeft(60000, 0), 60);
  assert.equal(h.resendSecondsLeft(60000, 1), 60);
  assert.equal(h.resendSecondsLeft(60000, 59999), 1);
  assert.equal(h.resendSecondsLeft(60000, 60000), 0);
  assert.equal(h.resendSecondsLeft(60000, 999999), 0);
});
test('only server-confirmed email of the pending account can proceed', () => {
  const user = { email: 'Test@example.invalid', email_confirmed_at: '2026-01-01' };
  assert.equal(h.isConfirmedSignupUser(user, 'test@example.invalid'), true);
  assert.equal(h.isConfirmedSignupUser(user, 'other@example.invalid'), false);
  assert.equal(h.isConfirmedSignupUser({ email: user.email }, user.email), false);
  assert.equal(h.isConfirmedSignupUser({ email: user.email, confirmed_at: 'phone-only' }, user.email), false);
  assert.equal(h.isConfirmedSignupUser(null, user.email), false);
});
test('rate limit codes do not rely on one English message', () => {
  for (const error of [{ status: 429 }, { code: 'over_email_send_rate_limit' }, { message: 'For security purposes, wait' }]) assert.equal(h.isSignupEmailRateLimit(error), true);
  assert.equal(h.isSignupEmailRateLimit({ status: 503, message: 'offline' }), false);
});
test('read-only verification failure/timeout does not retry or change auth state', async () => {
  let reads = 0;
  assert.equal(await h.readSignupUserWithTimeout(async () => { reads++; return 'ok'; }, 30), 'ok');
  await assert.rejects(h.readSignupUserWithTimeout(async () => { reads++; throw Error('offline'); }, 30), /offline/);
  await assert.rejects(h.readSignupUserWithTimeout(() => { reads++; return new Promise(() => {}); }, 5), /signup_status_timeout/);
  assert.equal(reads, 3);
});
test('signup lock starts before referral async work, with no direct browser storage', () => {
  const source = read('app/signup/page.tsx');
  for (const name of ['handleSignup =', 'handleSocialSignup =']) {
    const handler = source.slice(source.indexOf(name));
    assert.ok(handler.indexOf('signupLock.current = true') < handler.indexOf('await validateCurrentReferralCode()'));
  }
  assert.ok(!/window\.(localStorage|sessionStorage)/.test(source));
  assert.match(source, /signal: AbortSignal.timeout\(4000\)/);
});
test('waiting screen never silently signs in, signs out, changes a password or skips phone verification', () => {
  const source = read('components/SignupEmailVerification.tsx');
  assert.match(source, /\/phone-verification\?next=/);
  assert.ok(!/signInWithPassword|signOut\(|updateUser\(|setSession\(|signUp\(/.test(source));
  assert.match(source, /setTimeout\(checkOnReturn, 0\)/);
  assert.match(source, /subscription.unsubscribe\(\)/);
  assert.match(source, /window.removeEventListener\("focus"/);
});
