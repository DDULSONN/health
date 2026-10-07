/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const mod = { exports: {} };
new Function('exports', ts.transpileModule(read('lib/onboarding-user.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod.exports);
const { readOnboardingUser } = mod.exports;
const member = { id: 'fixture', user_metadata: { nickname: '한글' } };
const ok = { data: { user: member }, error: null };
const options = () => ({ signal: new AbortController().signal, timeoutMs: 30, retryDelayMs: 1 });
test('verified identity and metadata returned unchanged with one read', async () => {
  let reads = 0;
  assert.equal(await readOnboardingUser({ getUser: async () => { reads++; return ok; } }, options()), member);
  assert.equal(reads, 1);
});
for (const error of [{ status: 503 }, { status: 429 }, { status: 403 }, { name: 'AuthRetryableFetchError' }]) {
  test('transient failure is not a guest: ' + JSON.stringify(error), async () => {
    let reads = 0;
    await assert.rejects(readOnboardingUser({ getUser: async () => { reads++; return { data: { user: null }, error }; } }, options()));
    assert.equal(reads, 2);
  });
}
for (const error of [null, { name: 'AuthSessionMissingError' }, { code: 'session_not_found' }, { code: 'user_not_found' }, { status: 401 }]) {
  test('definitive guest is not retried: ' + JSON.stringify(error), async () => {
    let reads = 0;
    assert.equal(await readOnboardingUser({ getUser: async () => { reads++; return { data: { user: null }, error }; } }, options()), null);
    assert.equal(reads, 1);
  });
}
test('one read retry recovers after a thrown network error', async () => {
  let reads = 0;
  assert.equal(await readOnboardingUser({ getUser: async () => { if (++reads === 1) throw Error('offline'); return ok; } }, options()), member);
  assert.equal(reads, 2);
});
test('deleted identity is never accepted', async () => {
  assert.equal(await readOnboardingUser({ getUser: async () => ({ data: { user: { ...member, deleted_at: '2026-01-01' } } }) }, options()), null);
});
test('timeouts are bounded and do not resolve to guest', async () => {
  let reads = 0;
  await assert.rejects(readOnboardingUser({ getUser: () => { reads++; return new Promise(() => {}); } }, options()), /identity_timeout/);
  assert.equal(reads, 2);
});
test('unmount aborts a pending read and never retries it', async () => {
  const controller = new AbortController(); let reads = 0, resolve;
  const pending = readOnboardingUser({ getUser: () => { reads++; return new Promise(r => { resolve = r; }); } }, { ...options(), signal: controller.signal });
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); resolve(ok);
  assert.equal(reads, 1);
});
test('abort during retry delay prevents the second read', async () => {
  const controller = new AbortController(); let reads = 0;
  const pending = readOnboardingUser({ getUser: async () => { reads++; throw Error('offline'); } }, { ...options(), retryDelayMs: 100, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(reads, 1);
});
test('pre-aborted checks never read auth', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readOnboardingUser({ getUser() { assert.fail('unexpected read'); } }, { signal: controller.signal }), { name: 'AbortError' });
});
test('signup handlers, OTP mutations, profile submission and upload handlers remain byte-identical', () => {
  // LF-normalized c22d36b handlers; works in shallow/no-Git deployment builds too.
  for (const [file, start, end, hash] of [
    ['app/signup/page.tsx', '  const handle', '\n  return (', '8a5798198d3fd5082a3c4918303d520d5483b1f37f7ca3818aab1a493d428370'],
    ['app/phone-verification/page.tsx', '  const sendCode =', '\n  if (checking)', 'ebe190d836898a7caf65ea1eefed6adac07b8a8227f75ba423acc8f30c89769e'],
    ['app/onboarding/dating/page.tsx', '  const importOpenCard =', '\n  if (checking)', 'fd9d533dd719c82c1c5e111971352b9934bb4be2fd3173252df9d62185c3caac'],
  ]) {
    const slice = source => { assert.ok(source.includes(start)); return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))); };
    assert.equal(createHash('sha256').update(slice(read(file))).digest('hex'), hash, file);
  }
});
