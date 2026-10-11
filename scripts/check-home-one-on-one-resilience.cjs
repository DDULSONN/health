/* eslint-disable @typescript-eslint/no-require-imports */
// Offline tests of the real home loader; synthetic responses only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(code, bindings = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('module', 'exports', ...Object.keys(bindings), js)(mod, mod.exports, ...Object.values(bindings));
  return mod.exports;
}
const { createLatestRequest } = evaluate(read('lib/latest-request.ts'));
const rules = evaluate(read('lib/dating-1on1-refresh-response.ts'));
const home = read('app/community/dating/cards/page.tsx');
const ast = ts.createSourceFile('home.tsx', home, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loader;
function visit(n) { if (ts.isVariableDeclaration(n) && n.name.getText(ast) === 'reloadOneOnOneHome') loader = n.initializer.getText(ast); ts.forEachChild(n, visit); }
visit(ast); assert.ok(loader);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const endpoint = '/api/dating/1on1/';
const phone = '010-0000-0000';
function fixture() {
  const state = {}, overrides = {}, calls = [];
  const ctx = {
    ...rules, useCallback: fn => fn, viewerLoggedIn: true,
    oneOnOneHomeRequest: createLatestRequest(), oneOnOneRecommendationsRequest: createLatestRequest(),
    oneOnOneRefreshNeedsReloadRef: { current: true },
    fetch: async (url, init) => {
      assert.ok(url.startsWith(endpoint)); assert.ok(!init.method || init.method === 'GET');
      calls.push(url); const name = url.slice(endpoint.length);
      if (overrides[name]) return overrides[name](init.signal);
      return Response.json(name === 'write-status' ? { canWrite: false, phoneVerified: true }
        : name === 'my' ? { items: [{ id: 'source', status: 'approved' }], plus: null }
        : name === 'matches/my' ? { items: [{ id: 'match', state: 'mutual_accepted', contact_exchange_status: 'approved', counterparty_phone: phone }] }
        : { items: [{ source_card_id: 'source', recommendations: [] }] });
    },
  };
  for (const name of ['OneOnOneHome', 'OneOnOneHomeError', 'OneOnOneHomeLoading', 'OneOnOneRecommendations', 'OneOnOneRecommendationsError', 'OneOnOneRecommendationsLoading']) ctx['set' + name] = value => { state[name] = value; };
  ctx.fetchClientJson = async (url, init, timeout) => {
    assert.equal(timeout, 15000); const response = await ctx.fetch(url, init); return { response, body: await response.json().catch(() => null) };
  };
  const make = loggedIn => evaluate('exports.reload = ' + loader, { ...ctx, viewerLoggedIn: loggedIn }).reload;
  return { ctx, state, overrides, calls, reload: make(true), logout: make(false) };
}
for (const failure of ['http', 'network', 'malformed']) test('recommendation ' + failure + ' never suppresses valid exchanged contacts', async () => {
  const f = fixture();
  f.overrides['recommendations/my'] = async () => { if (failure === 'network') throw Error('offline'); return failure === 'http' ? Response.json({}, { status: 503 }) : Response.json({ items: [null] }); };
  await f.reload();
  assert.equal(f.state.OneOnOneHome.matches[0].counterparty_phone, phone);
  assert.equal(f.state.OneOnOneHomeError, ''); assert.equal(f.state.OneOnOneHomeLoading, false);
  assert.ok(f.state.OneOnOneRecommendationsError); assert.deepEqual(f.state.OneOnOneRecommendations, []);
  assert.equal(f.state.OneOnOneRecommendationsLoading, false); assert.equal(f.calls.length, 4);
});
test('slow recommendations do not delay the core match commit or expose stale candidates', async () => {
  const f = fixture(), pending = deferred(); f.state.OneOnOneRecommendations = [{ source_card_id: 'stale' }];
  f.overrides['recommendations/my'] = () => pending.promise;
  const loading = f.reload(); await tick();
  assert.equal(f.state.OneOnOneHome.matches[0].counterparty_phone, phone); assert.equal(f.state.OneOnOneHomeLoading, false);
  assert.equal(f.state.OneOnOneRecommendationsLoading, true); assert.deepEqual(f.state.OneOnOneRecommendations, []);
  pending.resolve(Response.json({ items: [] })); await loading;
  assert.equal(f.state.OneOnOneRecommendationsLoading, false);
});
for (const name of ['write-status', 'my', 'matches/my']) for (const status of [401, 403, 503]) test(`${name} ${status} remains a blocking core error`, async () => {
  const f = fixture(); f.overrides[name] = async () => Response.json({ error: 'core read denied' }, { status }); await f.reload();
  assert.equal(f.state.OneOnOneHome, undefined); assert.equal(f.state.OneOnOneHomeError, 'core read denied');
});
for (const status of [401, 403]) test('recommendation auth error ' + status + ' remains blocking, unlike an availability error', async () => {
  const f = fixture(); f.overrides['recommendations/my'] = async () => Response.json({}, { status }); await f.reload();
  assert.match(f.state.OneOnOneHomeError, /로그인 상태와 이용 권한/);
});
for (const name of ['my', 'matches/my']) test(name + ' malformed success is never interpreted as no profile/no matches', async () => {
  const f = fixture(); f.overrides[name] = async () => Response.json({}); await f.reload();
  assert.equal(f.state.OneOnOneHome, undefined); assert.match(f.state.OneOnOneHomeError, /응답/);
});
test('refresh completion is strict: partial read does not reset the retry-only quota guard', async () => {
  const f = fixture(); f.overrides['recommendations/my'] = async () => Response.json({}, { status: 503 });
  await assert.rejects(f.reload(true, true), /새 후보 명단/); assert.equal(f.ctx.oneOnOneRefreshNeedsReloadRef.current, true);
  delete f.overrides['recommendations/my']; await f.reload(true, true);
  assert.equal(f.ctx.oneOnOneRefreshNeedsReloadRef.current, false); assert.equal(f.calls.length, 8);
});
for (const resolveLate of [true, false]) test('logout clears both streams and ignores late ' + (resolveLate ? 'success' : 'failure'), async () => {
  const f = fixture(), pending = deferred();
  for (const name of ['write-status', 'my', 'matches/my', 'recommendations/my']) f.overrides[name] = async () => { await pending.promise; if (!resolveLate) throw Error('old response'); return Response.json({ items: [] }); };
  const previous = f.reload(); await tick(); await f.logout(); pending.resolve(); await previous;
  assert.equal(f.state.OneOnOneHome, null); assert.deepEqual(f.state.OneOnOneRecommendations, []);
  assert.equal(f.state.OneOnOneHomeError, ''); assert.equal(f.state.OneOnOneRecommendationsError, '');
  assert.equal(f.state.OneOnOneHomeLoading, false); assert.equal(f.state.OneOnOneRecommendationsLoading, false);
});
test('new recommendation response wins even if the obsolete transport ignores abort', async () => {
  const f = fixture(), pending = deferred(); f.overrides['recommendations/my'] = () => pending.promise;
  const old = f.reload(); await tick(); delete f.overrides['recommendations/my']; await f.reload();
  pending.resolve(Response.json({ items: [{ source_card_id: 'old', recommendations: [] }] })); await old;
  assert.equal(f.state.OneOnOneRecommendations[0].source_card_id, 'source');
});
