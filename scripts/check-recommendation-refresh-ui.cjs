/* eslint-disable @typescript-eslint/no-require-imports */
// Execute actual page callbacks offline. No production requests or quota writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
function evaluate(source, bindings = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', 'module', ...Object.keys(bindings), js)(mod.exports, mod, ...Object.values(bindings));
  return mod.exports;
}
const latest = evaluate(fs.readFileSync(path.join(root, 'lib/latest-request.ts'), 'utf8'));
const payloadRules = evaluate(fs.readFileSync(path.join(root, 'lib/dating-1on1-refresh-response.ts'), 'utf8'));
function initializer(file, name) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, name);
  return expression;
}
function fixture(surface, outcome = 'ok', confirmation = true) {
  const state = { posts: 0, reads: 0, commits: 0, alerts: [], error: '', outcome };
  const file = surface === 'home' ? 'app/community/dating/cards/page.tsx' : 'app/mypage/page.tsx';
  const gate = latest.createLatestRequest();
  const recovery = { current: false };
  const common = {
    ...payloadRules, oneOnOneRefreshNeedsReloadRef: recovery,
    useCallback: fn => fn, viewerLoggedIn: true,
    oneOnOneHomeRequest: gate, oneOnOneRecommendationsRequest: gate,
    setOneOnOneHome: () => { state.commits++; }, setMyOneOnOneAutoRecommendations: () => { state.commits++; },
    setOneOnOneHomeError: value => { state.error = value; }, setOneOnOneRefreshReadError: value => { state.error = value; },
    setOneOnOneHomeLoading: () => {},
    fetch: async (_url, init) => {
      assert.notEqual(init?.method, 'POST');
      state.reads++;
      if (state.outcome === 'read-error') throw Error('offline');
      if (state.outcome === 'aborted-read') gate.cancel();
      if (state.outcome === 'null-group') return Response.json({ items: [null] });
      if (state.outcome === 'bad-extra') return Response.json({ items: [{ source_card_id: 'source', recommendations: [], admin_recommendations: 'not-a-list' }] });
      if (state.outcome === 'bad-photo') return Response.json({ items: [{ source_card_id: 'source', recommendations: [{ id: 'candidate', photo_signed_urls: {} }] }] });
      if (state.outcome === 'empty-read') return Response.json({ items: [] });
      return Response.json(state.outcome === 'bad-read' ? {} : { items: [{ source_card_id: 'source', recommendations: [] }] });
    },
  };
  const reloadName = surface === 'home' ? 'reloadOneOnOneHome' : 'reloadOneOnOneRecommendations';
  const reload = evaluate('exports.fn = ' + initializer(file, reloadName), common).fn;
  const handleName = surface === 'home' ? 'handleOneOnOneRecommendationRefresh' : 'handleRefreshOneOnOneRecommendations';
  const lock = { current: new Set() };
  const handler = evaluate('exports.fn = ' + initializer(file, handleName), {
    ...common, oneOnOneRefreshLocksRef: lock, oneOnOneRefreshReadError: '',
    oneOnOneHome: { recommendations: [{ source_card_id: 'source' }] },
    myOneOnOneAutoRecommendations: [{ source_card_id: 'source' }],
    setRefreshingOneOnOneRecommendationIds: () => {},
    confirm: () => confirmation, alert: message => state.alerts.push(message),
    buildOneOnOneRefreshConfirmation: () => 'CONFIRM',
    buildOneOnOneRefreshSuccess: () => 'SUCCESS',
    reloadOneOnOneHome: reload, reloadOneOnOneRecommendations: reload,
    fetch: async (_url, init) => {
      assert.equal(init.method, 'POST'); state.posts++;
      await Promise.resolve();
      if (state.outcome === 'lost-post') throw Error('POST response lost');
      if (state.outcome === 'null-post') return Response.json(null);
      if (state.outcome === 'string-ok') return Response.json({ ok: 'true' });
      return Response.json(state.outcome === 'bad-post' ? {} : { ok: true, refresh_remaining: 1 }, { status: state.outcome === 'server-error' ? 503 : 200 });
    },
  }).fn;
  return { state, handler, reload, gate, lock, recovery };
}
for (const surface of ['home', 'mypage']) {
  test(surface + ': successful double-click consumes once and displays success only after a committed read', async () => {
    const f = fixture(surface);
    await Promise.all([f.handler('source'), f.handler('source')]);
    assert.equal(f.state.posts, 1); assert.equal(f.state.commits, 1);
    assert.deepEqual(f.state.alerts, ['SUCCESS']); assert.equal(f.lock.current.size, 0);
  });
  for (const outcome of ['read-error', 'bad-read', 'lost-post', 'bad-post', 'server-error', 'null-group', 'bad-extra', 'bad-photo', 'null-post', 'string-ok', 'aborted-read']) {
    test(surface + ': ' + outcome + ' never claims the old page was refreshed; recovery is GET-only', async () => {
      const f = fixture(surface, outcome);
      await f.handler('source');
      assert.equal(f.state.posts, 1); assert.equal(f.state.commits, 0);
      assert.ok(f.state.error.includes('불러') || f.state.error.includes('확인'));
      assert.ok(!f.state.alerts.includes('SUCCESS'));
      assert.equal(f.recovery.current, true);
      // React has not re-rendered: the original callback must still refuse POST.
      await f.handler('source');
      assert.equal(f.state.posts, 1);
      if (outcome.startsWith('read') || outcome === 'bad-read') assert.ok(f.state.error.includes('1회는 처리'));
      f.state.outcome = 'ok';
      await f.reload(true, true);
      assert.equal(f.state.posts, 1); assert.equal(f.state.commits, 1); assert.equal(f.state.error, '');
      assert.equal(f.recovery.current, false);
      await f.handler('source');
      assert.equal(f.state.posts, 2); assert.equal(f.state.commits, 2);
    });
  }
  test(surface + ': a valid empty/small pool is not mistaken for a broken response', async () => {
    const f = fixture(surface, 'empty-read');
    await f.handler('source');
    assert.equal(f.state.posts, 1); assert.equal(f.state.commits, 1);
    assert.deepEqual(f.state.alerts, ['SUCCESS']); assert.equal(f.recovery.current, false);
  });
  test(surface + ': canceled confirmation does not send any request', async () => {
    const f = fixture(surface, 'ok', false);
    await f.handler('source');
    assert.equal(f.state.posts, 0); assert.equal(f.state.reads, 0);
  });
}

test('response guard permits ordinary and legacy optional fields without changing candidates/photos', () => {
  const value = { items: [{ source_card_id: 'source', recommendations: [{ id: 'candidate', name: '가나다',
    region: '서울', age: 29, birth_year: 1998, height_cm: 175, photo_signed_urls: ['/api/images/signed?fixture=1'] }],
    admin_recommendations: [], favorite_candidates: null }] };
  const before = structuredClone(value);
  assert.equal(payloadRules.isOneOnOneRecommendationPayload(value), true);
  assert.deepEqual(value, before);
  for (const value of [null, {}, { items: null }, { items: [null] }, { items: [{ recommendations: [] }] },
    { items: [{ source_card_id: 'source', recommendations: [{ id: 'c', name: {} }] }] },
    { items: [{ source_card_id: 'source', recommendations: [], favorite_candidates: [null] }] }]) {
    assert.equal(payloadRules.isOneOnOneRecommendationPayload(value), false);
  }
});
