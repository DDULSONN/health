/* eslint-disable @typescript-eslint/no-require-imports */
// Real helpers/GET handler with synthetic data. No production accounts or mail.
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, deps = {}) {
  const mod = { exports: {} };
  new Function('require', 'exports', ts.transpileModule(read(file), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText)(name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', deps);
    if (['react', 'react/jsx-runtime'].includes(name)) return require(name);
    throw Error('Unexpected dependency ' + name);
  }, mod.exports); return mod.exports;
}
const policy = load('lib/dating-1on1-participation.ts');
const input = () => ({ hasSentRequest: false, phoneVerified: true,
  cards: [{ id: 'own', status: 'approved' }], groups: [{ source_card_id: 'own', recommendations: [{ id: 'candidate' }] }], matches: [] });
test('first-send notice is display-only and accepts active submitted/reviewing/approved profiles', () => {
  for (const status of ['submitted', 'reviewing', 'approved']) {
    const f = input(); f.cards[0].status = status; const before = JSON.stringify(f);
    assert.equal(policy.shouldShowFirstOneOnOneRequest(f), true); assert.equal(JSON.stringify(f), before);
  }
});
for (const [name, patch] of Object.entries({ sent: { hasSentRequest: true }, unknown: { hasSentRequest: null },
  oldServer: { hasSentRequest: undefined }, unverified: { phoneVerified: false }, noProfile: { cards: [] },
  rejected: { cards: [{ id: 'own', status: 'rejected' }] }, archived: { cards: [{ id: 'own', status: 'approved', archived: true }] },
  empty: { groups: [] }, hidden: { groups: [{ source_card_id: 'own', recommendations: [{ id: 'candidate' }], hidden_candidate_ids: ['candidate'] }] },
  otherProfile: { groups: [{ source_card_id: 'old', recommendations: [{ id: 'candidate' }] }] },
  incoming: { matches: [{ role: 'candidate', state: 'source_selected' }] }, sentPending: { matches: [{ role: 'source', state: 'source_selected' }] },
  mutual: { matches: [{ state: 'mutual_accepted' }] }, legacyAccepted: { matches: [{ state: 'candidate_accepted' }] },
})) test('first-send notice is suppressed: ' + name, () => assert.equal(policy.shouldShowFirstOneOnOneRequest({ ...input(), ...patch }), false));
test('merely suggested/skipped profiles do not imply a request was sent', () => {
  assert.equal(policy.shouldShowFirstOneOnOneRequest({ ...input(), matches: [{ role: 'source', state: 'proposed' }, { state: 'source_skipped' }] }), true);
  assert.equal(policy.shouldShowFirstOneOnOneRequest({ ...input(), groups: [{ source_card_id: 'own', admin_recommendations: [{ id: 'extra' }] }] }), true);
});
const history = load('lib/dating-1on1-participation-server.ts');
function historyDb(records, mode) {
  const calls = []; let rows = records;
  const q = { select(column) { assert.equal(column, 'id'); return q; },
    eq(column, value) { calls.push([column, value]); rows = rows.filter(r => r[column] === value); return q; },
    not(column, op, value) { assert.deepEqual([column, op, value], ['source_selected_at', 'is', null]); rows = rows.filter(r => r[column] != null); return q; },
    limit(n) { assert.equal(n, 1); rows = rows.slice(0, n); return q; },
    abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return q; },
    then(resolve, reject) { return (mode === 'throw' ? Promise.reject(Error('timeout')) : Promise.resolve({
      data: mode === 'malformed' ? null : rows, error: mode === 'error' ? { code: '42501' } : null,
    })).then(resolve, reject); },
  };
  return { calls, from(table) { assert.equal(table, 'dating_1on1_match_proposals'); return q; } };
}
test('history includes old canceled/blocked requests but never another sender', async () => {
  for (const state of ['source_selected', 'source_skipped', 'candidate_rejected', 'admin_canceled']) {
    const db = historyDb([{ id: 'old', source_user_id: 'viewer', source_selected_at: '2025-01-01', state }]);
    assert.equal(await history.hasSentOneOnOneRequest(db, 'viewer'), true);
    assert.deepEqual(db.calls, [['source_user_id', 'viewer']]);
  }
  assert.equal(await history.hasSentOneOnOneRequest(historyDb([{ source_user_id: 'other', source_selected_at: '2025-01-01' },
    { source_user_id: 'viewer', source_selected_at: null }]), 'viewer'), false);
});
for (const mode of ['error', 'throw', 'malformed']) test('history failure becomes unknown, not first-time: ' + mode, async () =>
  assert.equal(await history.hasSentOneOnOneRequest(historyDb([], mode), 'viewer'), null));

function routeFixture({ user = 'viewer', flag = false, legacy = false } = {}) {
  let historyCalls = 0, queries = 0;
  const q = { select() { return q; }, eq() { return q; }, not() { return q; }, order() { return q; },
    async limit(n) { assert.equal(n, 20); queries++; return legacy && queries === 1
      ? { error: { message: 'priority_boost_expires_at' } } : { data: [{ id: 'own', status: 'approved', photo_paths: [], admin_tags: [] }] }; } };
  const api = load('app/api/dating/1on1/my/route.ts', {
    '@/lib/images': { buildSignedImageUrl: () => 'unused', extractStorageObjectPathFromBuckets: () => null },
    '@/lib/dating-1on1': {}, '@/lib/dating-1on1-identity': {}, '@/lib/dating-age': {}, '@/lib/request-origin': {}, '@/lib/user-ban-guard': {},
    '@/lib/supabase/server': { createAdminClient: () => ({ from: () => q }) },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: user ? { id: user } : null }) },
    '@/lib/dating-1on1-plus': { getActiveOneOnOnePlus: async () => null },
    '@/lib/dating-1on1-participation-server': { hasSentOneOnOneRequest: async (_, uid) => { assert.equal(uid, user); historyCalls++; return flag; } },
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
  }); return { get: url => api.GET(new Request('https://fixture.invalid/api/dating/1on1/my' + url)), calls: () => historyCalls };
}
test('profile GET authenticates before looking at request history', async () => {
  const f = routeFixture({ user: null }); assert.equal((await f.get('?participation=1')).status, 401); assert.equal(f.calls(), 0);
});
for (const legacy of [false, true]) for (const flag of [false, true, null]) test(`profile GET preserves profile response and optional flag: ${legacy}/${flag}`, async () => {
  const f = routeFixture({ legacy, flag }), res = await f.get('?participation=1'), body = await res.json();
  assert.equal(res.status, 200); assert.equal(body.items.length, 1); assert.equal(body.has_sent_request, flag);
  assert.equal(f.calls(), 1); assert.equal(res.headers.get('cache-control'), 'private, no-store');
});
test('existing mypage GET does not add a history query', async () => {
  const f = routeFixture(); assert.equal((await f.get('')).status, 200); assert.equal(f.calls(), 0);
});
test('inbox uses 1:1 name, safely escapes it, and preserves accept/reject controls', () => {
  const Inbox = load('components/dating/OneOnOneIncomingRequests.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Inbox, { requests: [{ id: 'one', counterparty_card: { name: '<가상회원>' } }],
    renderRequest: () => React.createElement('div', null, '수락 / 거절') }));
  assert.match(html, /&lt;가상회원&gt;님이 요청을 보냈어요/); assert.match(html, /수락 \/ 거절/);
  assert.match(html, /수락만으로 연락처가 공개되지는 않아요/);
});
test('first-request shortcut only moves focus; success marks sent before reloading', () => {
  const panel = read('components/dating/OneOnOneHomePanel.tsx'), home = read('app/community/dating/cards/page.tsx');
  assert.match(panel, /onClick=\{\(\) => jumpToSection\(recommendationSectionRef.current\)\}/);
  assert.match(panel, /!recommendationsLoading && !recommendationsError/);
  assert.equal((home.match(/setOneOnOneHome\(\(prev\) => prev \? \{ \.\.\.prev, hasSentRequest: true \} : prev\)/g) ?? []).length, 2);
  assert.doesNotMatch(read('lib/dating-1on1-participation-server.ts'), /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});
