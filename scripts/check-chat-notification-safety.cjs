/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { test } = require('node:test'), ts = require('typescript'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
function source(file) { return fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n'); }
function load(file, fetch = () => { throw Error('network forbidden'); }) {
  const loadedModule = { exports: {} };
  new Function('module', 'exports', 'fetch', ts.transpileModule(source(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(loadedModule, loadedModule.exports, fetch);
  return loadedModule.exports;
}
const { createLatestRequest } = load('lib/latest-request.ts');
const { parseNotificationPage, notificationHref } = load('lib/notification-view.ts');
const item = { id: 'a', is_read: false, created_at: '2026-09-27T00:00:00Z', actor_profile: null, title: '한글 알림', link: '/mypage?section=matching#open-card-received' };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
for (const outcome of ['success', 'failure', '404']) test('late A cannot commit, fail or finish after B: ' + outcome, async () => {
  const request = createLatestRequest(), a = deferred(), events = [];
  const first = request.run({ load: () => a.promise, commit: () => events.push('A'), fail: () => events.push('A-error'), finish: () => events.push('A-finish') });
  await Promise.resolve(); request.cancel();
  await request.run({ load: async () => 'B', commit: value => events.push(value), finish: () => events.push('B-finish') });
  if (outcome === 'failure') a.reject(Error('late')); else a.resolve(outcome);
  await first; assert.deepEqual(events, ['B', 'B-finish']);
});
test('A -> B -> A rejects the first A even if cancellation is ignored', async () => {
  const request = createLatestRequest(), old = deferred(), commits = [];
  const first = request.run({ load: () => old.promise, commit: value => commits.push(value) });
  await Promise.resolve(); request.cancel();
  await request.run({ load: async () => 'B', commit: value => commits.push(value) });
  request.cancel(); await request.run({ load: async () => 'new A', commit: value => commits.push(value) });
  old.resolve('old A'); await first; assert.deepEqual(commits, ['B', 'new A']);
});
test('focus/realtime/retry coalesce while a same-room request is pending', async () => {
  const request = createLatestRequest(), result = deferred(); let calls = 0;
  const options = { load: () => { calls++; return result.promise; }, commit: () => {} };
  const a = request.run(options), b = request.run(options); assert.equal(a, b);
  await Promise.resolve(); assert.equal(calls, 1); result.resolve({}); await a;
});
test('unmount cancels late commit and side effects', async () => {
  const request = createLatestRequest(), result = deferred(); let writes = 0;
  const pending = request.run({ load: () => result.promise, commit: () => writes++ });
  await Promise.resolve(); request.cancel(); result.resolve({}); await pending; assert.equal(writes, 0);
});
test('valid Korean notification and a genuinely empty inbox are accepted', () => {
  assert.deepEqual(parseNotificationPage({ items: [item], unread_count: 1 }), { items: [item], unread_count: 1 });
  assert.deepEqual(parseNotificationPage({ items: [], unread_count: 0 }), { items: [], unread_count: 0 });
});
for (const value of [null, {}, { items: [] }, { items: [null], unread_count: 0 }, { items: [item, item], unread_count: 2 },
  { items: [item], unread_count: -1 }, { items: [item], unread_count: '1' },
  { items: [{ ...item, is_read: 'false' }], unread_count: 1 }, { items: [{ ...item, title: {} }], unread_count: 1 },
  { items: [{ ...item, created_at: 'bad' }], unread_count: 1 }]) test('malformed notification is not an empty success: ' + JSON.stringify(value), () => assert.equal(parseNotificationPage(value), null));
for (const href of ['/mypage#dating-connections', '/community/dating/cards?tab=one_on_one', '/chat?source_kind=open&source_id=abc']) test('internal deep link preserved: ' + href, () => assert.equal(notificationHref(href), href));
for (const href of [null, '', 'javascript:alert(1)', 'https://outside.invalid', '//outside.invalid', '/\\outside.invalid', '/\noutside', ' /mypage']) test('unsafe link refused: ' + JSON.stringify(href), () => assert.equal(notificationHref(href), null));
test('client request respects caller abort without automatic retry', async () => {
  let calls = 0;
  const { fetchClientJson } = load('lib/client-json-request.ts', async (_, init) => { calls++; return new Promise((_, reject) => {
    const cancel = () => reject(new DOMException('aborted', 'AbortError'));
    if (init.signal.aborted) cancel(); else init.signal.addEventListener('abort', cancel, { once: true });
  }); });
  const controller = new AbortController(), promise = fetchClientJson('/local', { signal: controller.signal });
  controller.abort(); await assert.rejects(promise, { name: 'AbortError' }); assert.equal(calls, 1);
});
test('client request has a bounded timeout', async () => {
  const { fetchClientJson } = load('lib/client-json-request.ts', async (_, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')), { once: true })));
  await assert.rejects(fetchClientJson('/local', undefined, 10), { name: 'AbortError' });
});
test('malformed JSON is explicit null, not a fake empty success', async () => {
  const { fetchClientJson } = load('lib/client-json-request.ts', async () => ({ ok: true, json: async () => { throw Error('bad json'); } }));
  assert.equal((await fetchClientJson('/local')).body, null);
});
test('chat mutation, notification, matching, OTP and payment routes are unchanged', () => {
  for (const file of ['app/api/dating/chat/send/route.ts', 'app/api/dating/chat/read/route.ts',
    'app/api/dating/chat/leave/route.ts', 'app/api/dating/chat/report/route.ts', 'app/api/notifications/route.ts',
    'app/api/dating/1on1/matches/my/route.ts', 'app/api/payments/toss/confirm/route.ts',
    'app/api/mypage/phone-verification/verify/route.ts']) {
    assert.equal(source(file), execFileSync('git', ['show', 'b1e6ad6:' + file], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n'), file);
  }
  assert.match(source('app/chat/page.tsx'), /activeThreadDetail\.messages\.map/);
  assert.match(source('app/notifications/page.tsx'), /void markOneRead\(item\)/);
  assert.ok(!source('app/notifications/page.tsx').includes('router.refresh()'));
});
