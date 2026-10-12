/* eslint-disable @typescript-eslint/no-require-imports */
// Real loader + resume scheduler, synthetic transport only. No live keys or writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(source, bindings = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', ...Object.keys(bindings), js)(mod, mod.exports, ...Object.values(bindings));
  return mod.exports;
}
const { createLatestRequest } = evaluate(read('lib/latest-request.ts'));
const page = read('app/mypage/page.tsx');
const ast = ts.createSourceFile('page.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loader;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'reloadOneOnOneMatches') loader = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast); assert.ok(loader);
const match = { id: 'fixture-match', role: 'candidate', state: 'source_selected', counterparty_card: null };
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
function fixture() {
  const state = { OneOnOneMatchesLoaded: false }, calls = [], request = createLatestRequest();
  const lastRequest = { current: 0 };
  let response = async () => ({ response: { ok: true, status: 200 }, body: { items: [match] } });
  const bindings = { useCallback: fn => fn, oneOnOneMatchesRequest: request,
    oneOnOneMatchesLastRequestAtRef: lastRequest,
    fetchClientJson: async (url, init, timeout) => {
      assert.equal(url, '/api/dating/1on1/matches/my'); assert.equal(init.cache, 'no-store');
      assert.ok(!init.method || init.method === 'GET'); assert.equal(timeout, 15000);
      calls.push(init); return response();
    },
  };
  for (const name of ['MyOneOnOneMatches','OneOnOneMatchesLoaded','OneOnOneMatchesLoading','OneOnOneMatchesError']) bindings['set' + name] = value => { state[name] = value; };
  return { state, calls, request, lastRequest, setResponse: fn => { response = fn; },
    reload: evaluate('exports.reload = ' + loader, bindings).reload };
}
test('independent successful read exposes incoming requests before any unrelated data finishes', async () => {
  const f = fixture(); await f.reload();
  assert.deepEqual(f.state.MyOneOnOneMatches, [match]); assert.equal(f.state.OneOnOneMatchesLoaded, true);
  assert.equal(f.state.OneOnOneMatchesLoading, false); assert.equal(f.state.OneOnOneMatchesError, '');
  assert.ok(f.lastRequest.current > 0);
});
test('matching list refresh joins a pending GET rather than issuing another request', async () => {
  const f = fixture(), gate = deferred(); f.setResponse(() => gate.promise);
  const one = f.reload(false), two = f.reload(false); await tick();
  assert.equal(f.calls.length, 1); assert.equal(f.state.OneOnOneMatchesLoading, true);
  gate.resolve({ response: { ok: true }, body: { items: [] } }); await Promise.all([one,two]);
  assert.deepEqual(f.state.MyOneOnOneMatches, []); assert.equal(f.state.OneOnOneMatchesLoaded, true);
});
for (const bad of [null, {}, { items: null }, { items: [null] }, { items: [{ id: 'x', state: 'source_selected' }] }]) {
  test('malformed success is an error, not an empty inbox: ' + JSON.stringify(bad), async () => {
    const f = fixture(); f.setResponse(async () => ({ response: { ok: true }, body: bad }));
    await assert.rejects(f.reload()); assert.equal(f.state.OneOnOneMatchesLoaded, false);
    assert.equal(f.state.OneOnOneMatchesLoading, false); assert.match(f.state.OneOnOneMatchesError, /응답/);
  });
}
for (const failure of ['http', 'network', 'timeout']) test(failure + ' keeps previously loaded requests and allows retry', async () => {
  const f = fixture(); await f.reload();
  f.setResponse(async () => {
    if (failure === 'http') return { response: { ok: false, status: 503 }, body: {} };
    const error = new Error('offline'); if (failure === 'timeout') error.name = 'AbortError'; throw error;
  });
  await assert.rejects(f.reload()); assert.deepEqual(f.state.MyOneOnOneMatches, [match]);
  assert.equal(f.state.OneOnOneMatchesLoaded, true); assert.equal(f.state.OneOnOneMatchesLoading, false);
  assert.ok(f.state.OneOnOneMatchesError);
  f.setResponse(async () => ({ response: { ok: true }, body: { items: [] } }));
  await f.reload(); assert.equal(f.state.OneOnOneMatchesError, ''); assert.deepEqual(f.state.MyOneOnOneMatches, []);
});
for (const status of [401,403]) test(status + ' clears private results and never reports an empty-success inbox', async () => {
  const f = fixture(); await f.reload();
  f.setResponse(async () => ({ response: { ok: false, status }, body: {} }));
  await assert.rejects(f.reload()); assert.deepEqual(f.state.MyOneOnOneMatches, []);
  assert.equal(f.state.OneOnOneMatchesLoaded, false);
  assert.match(f.state.OneOnOneMatchesError, /로그인/);
});
for (const status of [200,401,503]) test('obsolete ' + status + ' response cannot replace or clear the current inbox', async () => {
  const f = fixture(), old = deferred(); f.setResponse(() => old.promise);
  const pending = f.reload(); await tick();
  f.setResponse(async () => ({ response: { ok: true }, body: { items: [match] } })); await f.reload();
  old.resolve({ response: { ok: status === 200, status }, body: { items: [] } }); await pending;
  assert.deepEqual(f.state.MyOneOnOneMatches, [match]); assert.equal(f.state.OneOnOneMatchesLoaded, true);
  assert.equal(f.state.OneOnOneMatchesError, '');
});
test('canceled read cannot populate a new session', async () => {
  const f = fixture(), gate = deferred(); f.setResponse(() => gate.promise);
  const pending = f.reload(); await tick(); f.request.cancel();
  gate.resolve({ response: { ok: true }, body: { items: [match] } }); await pending;
  assert.equal(f.state.MyOneOnOneMatches, undefined); assert.equal(f.state.OneOnOneMatchesLoaded, false);
});
function scheduler() {
  const win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = 'visible';
  let now = 10000, last = 10000, id = 0, refreshes = 0; const timers = new Map();
  const { subscribeVisiblePageRefresh } = evaluate(read('lib/visible-page-refresh.ts'), {
    window: win, document: doc, Date: { now: () => now },
    setTimeout: (fn, delay) => { timers.set(++id, {fn,at:now+delay}); return id; },
    clearTimeout: key => timers.delete(key),
  });
  return { win, doc, timers, count: () => refreshes,
    subscribe: enter => subscribeVisiblePageRefresh(() => { refreshes++; last=now; }, () => last, enter),
    advance: ms => { now+=ms; for (const [key,timer] of timers) if (timer.at<=now) { timers.delete(key); timer.fn(); } },
    show: persisted => { const e=new Event('pageshow'); e.persisted=persisted; win.dispatchEvent(e); },
  };
}
test('resume events coalesce, are throttled, and never create periodic polling', () => {
  const f=scheduler(), stop=f.subscribe(false); assert.equal(f.timers.size,0);
  f.win.dispatchEvent(new Event('focus')); f.doc.dispatchEvent(new Event('visibilitychange')); f.show(true);
  assert.equal(f.timers.size,1); f.advance(4999); assert.equal(f.count(),0);
  f.advance(1); assert.equal(f.count(),1); f.advance(60000); assert.equal(f.count(),1);
  stop(); f.win.dispatchEvent(new Event('focus')); assert.equal(f.timers.size,0);
});
test('hidden pages and normal initial pageshow do not trigger reads; cleanup cancels queued work', () => {
  const f=scheduler(), stop=f.subscribe(false); f.show(false); assert.equal(f.timers.size,0);
  f.doc.visibilityState='hidden'; f.win.dispatchEvent(new Event('focus')); assert.equal(f.timers.size,0);
  f.doc.visibilityState='visible'; f.win.dispatchEvent(new Event('focus'));
  f.doc.visibilityState='hidden'; f.advance(5000); assert.equal(f.count(),0);
  f.doc.visibilityState='visible'; f.show(true); stop(); f.advance(5000); assert.equal(f.count(),0);
});
test('returning to an already-loaded matching tab schedules only one fresh check', () => {
  const f=scheduler(), stop=f.subscribe(true); f.advance(5000); assert.equal(f.count(),1); stop();
});
