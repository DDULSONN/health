/* eslint-disable @typescript-eslint/no-require-imports */
// Offline lifecycle regression tests: no real accounts, mail, OTP, or payments.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const home = read('app/community/dating/cards/page.tsx');
const tree = ts.createSourceFile('home.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(n) { if (predicate(n)) result = n; ts.forEachChild(n, visit); }
  visit(tree); assert.ok(result); return result;
}
function effect(marker, ctx) {
  const node = find(n => ts.isCallExpression(n) && n.expression.getText(tree) === 'useEffect'
    && n.arguments[0].getText(tree).includes(marker));
  return evaluate(node.arguments[0].getText(tree), ctx)();
}
function callback(name, ctx) {
  const node = find(n => ts.isVariableDeclaration(n) && n.name.getText(tree) === name);
  return evaluate(node.initializer.arguments[0].getText(tree), ctx);
}
function evaluate(source, ctx) {
  const js = ts.transpileModule('(' + source + ');', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(js, ctx);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(tab = 'open_cards', response) {
  const calls = [], writes = [], timers = new Map(), listeners = new Map();
  let now = 1_000_000;
  const ctx = {
    homeFeatureTab: tab, homeFeatureTabRef: { current: tab }, activeSexRef: { current: 'female' },
    secondaryCardsRequestRef: { current: 0 }, cardsAudience: { status: 'resolved', canSwitchSex: false, targetSex: 'female' },
    AbortController, Date: { now: () => now },
    window: { setInterval(fn, ms) { assert.equal(ms, 300000); timers.set(1, fn); return 1; }, clearInterval: id => timers.delete(id) },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    fetch: async (url, options) => { calls.push({ url, options }); return response ? response(url, options) : {
      ok: true, json: async () => url.includes('queue-stats') ? { count: 3 } : url.includes('/list?') ? { items: [{ id: 'visible' }] } : { loggedIn: true, male: 'approved', female: 'approved' },
    }; },
  };
  for (const name of ['QueueStats', 'MoreViewStatus', 'MoreViewMale', 'MoreViewFemale']) ctx['set' + name] = value => writes.push({ name, value });
  return { ctx, calls, writes, timers, listeners, tick: async () => { timers.get(1)?.(); await flush(); await flush(); }, advance: ms => { now += ms; } };
}
for (const tab of ['one_on_one', 'quick_match', 'love_fortune']) test(tab + ': no open-card polling timer, listener or request', async () => {
  const f = fixture(tab); assert.equal(effect('SECONDARY_POLL_INTERVAL_MS', f.ctx), undefined);
  await f.tick(); assert.equal(f.calls.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0);
});
test('visible open cards poll the selected sex only and still refresh counts', async () => {
  const f = fixture(); const stop = effect('SECONDARY_POLL_INTERVAL_MS', f.ctx); await f.tick();
  assert.deepEqual(f.calls.map(c => c.url), ['/api/dating/cards/more-view/status', '/api/dating/cards/queue-stats', '/api/dating/cards/more-view/list?sex=female']);
  assert.ok(f.writes.some(w => w.name === 'QueueStats')); assert.ok(f.writes.some(w => w.name === 'MoreViewFemale'));
  assert.ok(!f.writes.some(w => w.name === 'MoreViewMale')); stop();
  assert.equal(f.timers.size, 0); assert.equal(f.listeners.size, 0); assert.ok(f.calls.every(c => c.options.signal.aborted));
});
test('hidden document does not poll; returning visible is throttled', async () => {
  const f = fixture(); const stop = effect('SECONDARY_POLL_INTERVAL_MS', f.ctx);
  f.ctx.document.visibilityState = 'hidden'; await f.tick(); assert.equal(f.calls.length, 0);
  f.ctx.document.visibilityState = 'visible'; f.listeners.get('visibilitychange')(); await flush();
  assert.equal(f.calls.length, 3); f.listeners.get('visibilitychange')(); await flush(); assert.equal(f.calls.length, 3);
  f.advance(60000); f.listeners.get('visibilitychange')(); await flush(); assert.equal(f.calls.length, 6); stop();
});
for (const change of ['unmount', 'tab', 'sex', 'new-request']) test('late background response is ignored after ' + change, async () => {
  const pending = deferred(); const f = fixture('open_cards', () => pending.promise);
  const stop = effect('SECONDARY_POLL_INTERVAL_MS', f.ctx); await f.tick(); assert.equal(f.calls.length, 2);
  await f.tick(); assert.equal(f.calls.length, 2, 'no overlapping polling');
  if (change === 'unmount') stop();
  if (change === 'tab') f.ctx.homeFeatureTabRef.current = 'one_on_one';
  if (change === 'sex') f.ctx.activeSexRef.current = 'male';
  if (change === 'new-request') f.ctx.secondaryCardsRequestRef.current++;
  pending.resolve({ ok: true, json: async () => ({ items: [{ id: 'stale' }], female: 'approved' }) });
  await flush(); await flush(); assert.equal(f.writes.length, 0); assert.equal(f.calls.length, 2); stop();
});
test('tab change while JSON is decoding cannot commit old counters or cards', async () => {
  const pending = deferred(), f = fixture('open_cards', () => ({ ok: true, json: () => pending.promise }));
  const stop = effect('SECONDARY_POLL_INTERVAL_MS', f.ctx); await f.tick(); stop();
  pending.resolve({ female: 'approved', items: [] }); await flush(); assert.equal(f.writes.length, 0);
});
test('poll errors preserve displayed cards and release the in-flight lock for retry', async () => {
  let fail = true;
  const f = fixture('open_cards', async () => { if (fail) throw Error('offline'); return { ok: true, json: async () => ({}) }; });
  const stop = effect('SECONDARY_POLL_INTERVAL_MS', f.ctx); await f.tick(); assert.equal(f.writes.length, 0);
  fail = false; await f.tick(); assert.equal(f.calls.length, 4); assert.ok(f.writes.length > 0); stop();
});
test('audience restriction prevents fetching an unauthorized sex', async () => {
  const f = fixture(); f.ctx.activeSexRef.current = 'male'; const stop = effect('SECONDARY_POLL_INTERVAL_MS', f.ctx);
  await f.tick(); assert.equal(f.calls.length, 2); stop();
});
for (const tab of ['one_on_one', 'quick_match', 'love_fortune']) test(tab + ': initial common audience load does not start paid/more-view reads', async () => {
  const f = fixture(tab); await callback('refreshSecondary', f.ctx)(); assert.equal(f.calls.length, 0);
});
for (const tab of ['open_cards', 'one_on_one', 'love_fortune']) test(tab + ': no quick-match candidate or subscription prefetch', () => {
  const f = fixture(tab); Object.assign(f.ctx, { viewerLoggedIn: true, setSwipeMessage() {} });
  assert.equal(effect('void loadSwipe(activeSex', f.ctx), undefined);
  assert.equal(effect('const loadSwipeSubscriptionStatus', f.ctx), undefined); assert.equal(f.calls.length, 0);
});
for (const tab of ['one_on_one', 'quick_match', 'love_fortune']) test(tab + ': no reels prefetch', () => {
  const f = fixture(tab); assert.equal(effect('setReelsListingsLoading(true)', f.ctx), undefined); assert.equal(f.calls.length, 0);
});
test('first common audience read remains; returning to open cards refreshes, hidden tab switching does not', async () => {
  const ctx = { snapshotReady: true, initialCardsStartedRef: { current: false }, loadedOpenCardSexesRef: { current: { male: false, female: false } }, homeFeatureTab: 'one_on_one', restoredSnapshot: null, queueMicrotask };
  const calls = []; ctx.loadInitial = async value => calls.push(value);
  effect('initialCardsStartedRef.current', ctx); await flush(); assert.equal(calls.length, 1);
  ctx.homeFeatureTab = 'quick_match'; effect('initialCardsStartedRef.current', ctx); await flush(); assert.equal(calls.length, 1);
  ctx.homeFeatureTab = 'open_cards'; effect('initialCardsStartedRef.current', ctx); await flush(); assert.equal(calls.length, 2);
  ctx.homeFeatureTab = 'one_on_one'; effect('initialCardsStartedRef.current', ctx); await flush(); assert.equal(calls.length, 2);
});
test('returning to an already loaded open-card list keeps pagination instead of resetting page one', async () => {
  let refreshed = 0;
  const ctx = { snapshotReady: true, initialCardsStartedRef: { current: true }, loadedOpenCardSexesRef: { current: { male: true, female: false } },
    homeFeatureTab: 'open_cards', restoredSnapshot: null, queueMicrotask, loadInitial: () => { throw Error('must preserve loaded pages'); },
    refreshSecondary: () => { refreshed++; } };
  effect('initialCardsStartedRef.current', ctx); await flush(); assert.equal(refreshed, 1);
});
test('switching away invalidates old paid reads; returning cannot restore their stale data', async () => {
  const f = fixture(), pending = deferred(), state = {};
  let first = true;
  Object.assign(f.ctx, {
    readDatingJson: async url => url.includes('/paid/list') ? (first ? pending.promise : { items: [{ id: 'fresh-paid' }] }) : null,
  });
  for (const name of ['PaidItems', 'PaidCardsError', 'PaidCardsLoading', 'QueueStats', 'MoreViewStatus', 'MoreViewMale', 'MoreViewFemale']) f.ctx['set' + name] = value => { state[name] = value; };
  const refresh = callback('refreshSecondary', f.ctx), old = refresh();
  const layout = find(n => ts.isCallExpression(n) && n.expression.getText(tree) === 'useLayoutEffect'
    && n.arguments[0].getText(tree).includes('homeFeatureTabRef.current = homeFeatureTab'));
  f.ctx.homeFeatureTab = 'one_on_one'; evaluate(layout.arguments[0].getText(tree), f.ctx)();
  assert.equal(f.ctx.secondaryCardsRequestRef.current, 2);
  await refresh();
  f.ctx.homeFeatureTab = 'open_cards'; evaluate(layout.arguments[0].getText(tree), f.ctx)();
  first = false; await refresh();
  pending.resolve({ items: [{ id: 'stale-paid' }] }); await old;
  assert.equal(state.PaidItems[0].id, 'fresh-paid'); assert.equal(state.PaidCardsLoading, false);
});
test('unmounted initial effect never starts its queued request (including StrictMode replay)', async () => {
  const ctx = { snapshotReady: true, initialCardsStartedRef: { current: false }, homeFeatureTab: 'open_cards', restoredSnapshot: null, queueMicrotask, loadInitial: () => { throw Error('late load'); } };
  effect('initialCardsStartedRef.current', ctx)(); await flush(); assert.equal(ctx.initialCardsStartedRef.current, false);
});
test('1:1 view is a conditional dynamic import, not a static runtime import', () => {
  assert.match(home, /dynamic\(\(\) => import\("@\/components\/dating\/OneOnOneHomePanel"\)/);
  assert.match(home, /\{showOneOnOneSection \? \(\s*<OneOnOneHomePanel/);
  assert.doesNotMatch(home, /import OneOnOneHomePanel from/);
});
// Exact function hashes from deployed af0ee5b before the mechanical extraction.
// Future intentional view edits should update these reviewed baselines explicitly.
const movedFunctions = {
  OneOnOneHomePanel: 'c86e0995598265c7212bba1c7c5236d3ab05ff31178f6d6ab17b35c82723d4ec',
  OneOnOneCandidateCard: '487a01e43341fe6dbf238595514a7af4f2d3178968ab175b25a8237898cf7bb1',
  OneOnOneMatchActions: '3f514f345366b8714d510c5ca8497c5e5a7be7da654e1653b1bdf45e7bcac6e5',
  canCancelOneOnOneMatchPreview: '0ec3faad4e8701ea4622ea220af8ebaddaf725cfa52a70fc686b82a37444036c',
  getOneOnOneDisplayName: 'cb337ea077c58b6fe6105cb1d3cb1079f5d0e8f3113e7a8bbd482dd3544ee0e9',
  getOneOnOneAge: 'c069134d53c6fc6f79762fd0e6cc9522c953f489bcbd85bef3cae9c4ae72aa84',
  getOneOnOneMeta: '69c12ee8d518ac7eb00811fde82b6602abad3471eda01cf664dd03233489e163',
  oneOnOneContactLabel: 'c7bcaf1620f1111c3b164ec6f71a6fb090a751162a2048cca29473e6a949d577',
};
for (const [name, hash] of Object.entries(movedFunctions)) test('extraction preserves rendering/behavior byte-for-byte: ' + name, () => {
  const code = read('components/dating/OneOnOneHomePanel.tsx');
  const ast = ts.createSourceFile('panel.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.ok(node);
  const text = node.getText(ast).replace(/^export default /, '').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), hash);
});
