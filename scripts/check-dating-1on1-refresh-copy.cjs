/* eslint-disable @typescript-eslint/no-require-imports */
// Offline only: exercise real UI handlers and copy without touching a real account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(code, bindings = {}) {
  const output = ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(bindings), output)(require, mod, mod.exports, ...Object.values(bindings));
  return mod.exports;
}
const copy = evaluate(read('lib/dating-1on1-refresh-copy.ts'));
const parsed = new Map();
function ast(file) {
  if (!parsed.has(file)) parsed.set(file, ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
  return parsed.get(file);
}
function find(node, predicate) {
  if (predicate(node)) return node;
  let result;
  ts.forEachChild(node, child => { if (!result) result = find(child, predicate); });
  return result;
}
const homeFile = 'app/community/dating/cards/page.tsx';
const myFile = 'app/mypage/page.tsx';
const nextAt = '2026-09-17T14:56:35.484405+00:00';
const quota = (remaining = 1, limit = 2) => ({ source_card_id: 'fixture-card', refresh_limit: limit,
  refresh_remaining: remaining, can_refresh: remaining > 0, next_refresh_at: remaining === 0 ? nextAt : null });

for (const limit of [1, 2]) for (let remaining = 1; remaining <= limit; remaining++) {
  test(`confirmation clearly distinguishes before/after: ${remaining}/${limit}`, () => {
    const result = copy.buildOneOnOneRefreshConfirmation(quota(remaining, limit));
    assert.ok(result.includes(`사용 전 ${remaining}회 → 이번 사용 후 ${remaining - 1}회`));
    assert.ok(result.includes(`최근 24시간 기준 최대 ${limit}회`));
    assert.ok(result.includes('자정에 초기화되지 않아요'));
    assert.ok(!result.includes('\ufffd'));
  });
}
test('empty or invalid data never invents exhaustion, a negative balance or an eligibility time', () => {
  assert.equal(copy.getOneOnOneRefreshCopy(null).button, '이용 상태 확인 중');
  for (const value of [undefined, null, NaN, -1, 1.5, '2']) {
    const input = { refresh_remaining: value, refresh_limit: value, next_refresh_at: 'invalid' };
    const text = JSON.stringify(copy.getOneOnOneRefreshCopy(input)) + copy.buildOneOnOneRefreshConfirmation(input) + copy.buildOneOnOneRefreshSuccess(input);
    assert.ok(!/NaN|Invalid Date|-1회|undefined|이용 완료/.test(text));
  }
});
test('next refresh is KST, rounded up to the first eligible second', () => {
  const result = copy.formatOneOnOneNextRefresh(nextAt);
  assert.match(result, /9\. 17\./); assert.match(result, /오후 11:56:36/);
  assert.equal(copy.formatOneOnOneNextRefresh('invalid'), null);
  const midnight = copy.formatOneOnOneNextRefresh('2026-09-17T14:59:59.900Z');
  assert.match(midnight, /9\. 18\./); assert.match(midnight, /오전 12:00:00/);
});
test('exhausted copy preserves membership meaning and shows the server-provided next time', () => {
  const result = copy.getOneOnOneRefreshCopy(quota(0));
  assert.equal(result.button, '다음 이용 대기');
  assert.match(result.summary, /2회 중 0회/);
  assert.match(result.next, /오후 11:56:36부터 \(한국 시간\)/);
  assert.ok(!JSON.stringify(result).includes('24시간 이용 완료'));
});
test('success never mistakes an unknown balance for zero or repeats the pre-use count', () => {
  assert.match(copy.buildOneOnOneRefreshSuccess(quota(0)), /사용 후 0회/);
  assert.match(copy.buildOneOnOneRefreshSuccess(quota(1)), /사용 후 1회/);
  assert.ok(!copy.buildOneOnOneRefreshSuccess({}).includes('0회'));
});

function handler(kind, options = {}) {
  const file = kind === 'home' ? homeFile : myFile;
  const name = kind === 'home' ? 'handleOneOnOneRecommendationRefresh' : 'handleRefreshOneOnOneRecommendations';
  const node = find(ast(file), n => ts.isVariableDeclaration(n) && n.name.getText() === name);
  assert.ok(node);
  const fn = kind === 'home' ? node.initializer.arguments[0] : node.initializer;
  const calls = [], alerts = [], confirmations = [], states = [];
  let pending = options.busy ? ['fixture-card'] : [];
  const usage = options.usage ?? quota(1);
  const bindings = {
    ...copy,
    refreshingOneOnOneRecommendationIds: pending,
    oneOnOneRefreshLocksRef: { current: new Set(pending) }, oneOnOneRefreshReadError: '',
    oneOnOneRefreshNeedsReloadRef: { current: false },
    setOneOnOneHomeError: message => { if (message) alerts.push(message); },
    setOneOnOneRefreshReadError: message => { if (message) alerts.push(message); },
    oneOnOneHome: { recommendations: [usage] }, myOneOnOneAutoRecommendations: [usage],
    setRefreshingOneOnOneRecommendationIds: update => { pending = update(pending); states.push([...pending]); },
    confirmOneOnOneRefresh: async usage => { confirmations.push(copy.buildOneOnOneRefreshConfirmation(usage)); return options.confirm !== false; },
    setOneOnOneRefreshNotice: notice => { if (notice) alerts.push(notice.message); },
    reloadOneOnOneHome: async () => calls.push('reload'),
    reloadOneOnOneRecommendations: async () => calls.push('reload'),
    fetchClientJson: async (url, init, timeout) => {
      assert.equal(timeout, 30000);
      calls.push('post');
      assert.equal(url, '/api/dating/1on1/recommendations/refresh');
      assert.equal(init.method, 'POST');
      assert.deepEqual(JSON.parse(init.body), { source_card_id: 'fixture-card' });
      if (options.networkError) throw new Error('fixture network failure');
      const body = options.body ?? { ok: true, ...quota(0) };
      return { response: Response.json(body, { status: options.status ?? 200 }), body };
    },
  };
  const run = evaluate('exports.run = ' + fn.getText(ast(file)) + ';', bindings).run;
  return { run: () => run('fixture-card'), calls, alerts, confirmations, states };
}
for (const kind of ['home', 'mypage']) {
  test(`${kind}: cancellation does not consume or reload`, async () => {
    const view = handler(kind, { confirm: false }); await view.run();
    assert.match(view.confirmations[0], /사용 전 1회 → 이번 사용 후 0회/);
    assert.deepEqual(view.calls, []); assert.deepEqual(view.alerts, []); assert.deepEqual(view.states, []);
  });
  test(`${kind}: completion uses actual POST balance and next time, not the stale screen`, async () => {
    const view = handler(kind, { usage: quota(2) }); await view.run();
    assert.match(view.confirmations[0], /사용 전 2회 → 이번 사용 후 1회/);
    assert.deepEqual(view.calls, ['post', 'reload']);
    assert.match(view.alerts[0], /사용 후 0회/); assert.match(view.alerts[0], /오후 11:56:36/);
    assert.deepEqual(view.states.at(-1), []);
  });
  for (const remaining of [0, 1]) test(`${kind}: actual successful remaining ${remaining} is shown`, async () => {
    const view = handler(kind, { body: { ok: true, ...quota(remaining) } }); await view.run();
    assert.match(view.alerts[0], new RegExp(`사용 후 ${remaining}회`));
  });
  test(`${kind}: rejection does not claim success or retry consumption`, async () => {
    const view = handler(kind, { status: 409, body: { error: '사용 횟수를 모두 이용했어요.', request_id: 'fixture-id' } });
    await view.run(); assert.deepEqual(view.calls, ['post']);
    assert.match(view.alerts[0], /fixture-id/); assert.ok(!view.alerts[0].includes('1회를 사용했어요'));
    assert.deepEqual(view.states.at(-1), []);
  });
  test(`${kind}: network failure clears the pending indicator without automatic retries`, async () => {
    const view = handler(kind, { networkError: true }); await view.run();
    assert.deepEqual(view.calls, ['post']); assert.match(view.alerts[0], /network failure/);
    assert.deepEqual(view.states.at(-1), []);
  });
  test(`${kind}: existing in-flight guard still prevents another request`, async () => {
    const view = handler(kind, { busy: true }); await view.run();
    assert.deepEqual(view.calls, []); assert.deepEqual(view.confirmations, []);
  });
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  return Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : String(tree ?? '');
}
for (const remaining of [0, 1, 2]) test(`real home result markup shows ${remaining} remaining and preserves button permission`, () => {
  const source = ast(homeFile);
  const call = find(source, n => ts.isCallExpression(n) && n.expression.getText(source) === 'recommendationGroups.map');
  const render = evaluate('exports.render = ' + call.arguments[0].getText(source) + ';', {
    ...copy, activeCards: [], refreshingRecommendationIds: [], onRefreshRecommendations() {},
    OneOnOneRefreshControl: 'RefreshControl', refreshNotice: null,
  }).render;
  const tree = render({ ...quota(remaining), recommendations: [], admin_recommendations: [] }, 0);
  const control = nodes(tree).find(n => n.type === 'RefreshControl');
  assert.equal(control.props.blocked, remaining === 0);
  assert.equal(control.props.usage.refresh_remaining, remaining);
  assert.equal(control.props.busy, false);
});
for (const remaining of [0, 1]) test(`real mypage refresh button preserves availability ${remaining}`, () => {
  const source = ast(myFile);
  const node = find(source, n => ts.isJsxSelfClosingElement(n) && n.tagName.getText() === 'OneOnOneRefreshControl'
    && n.getText(source).includes('handleRefreshOneOnOneRecommendations(item.id)'));
  const tree = evaluate('exports.tree = ' + node.getText(source) + ';', {
    item: { id: 'fixture-card' }, handleRefreshOneOnOneRecommendations() {},
    canRefreshAutoRecommendations: remaining > 0, refreshingAutoRecommendations: false,
    oneOnOneRefreshReadError: '',
    OneOnOneRefreshControl: 'RefreshControl', autoRecommendationGroup: quota(remaining), oneOnOneRefreshNotice: null,
  }).tree;
  assert.equal(tree.props.blocked, remaining === 0);
  assert.equal(tree.props.usage.refresh_remaining, remaining);
});
test('all affected customer copy drops ambiguous calendar-day/completion wording', () => {
  for (const file of [homeFile, myFile, 'components/dating/DatingPlusOffers.tsx']) {
    const source = read(file);
    assert.ok(!source.includes('24시간 이용 완료'));
    assert.ok(!source.includes('후보 새로고침 하루 2회'));
  }
  assert.ok(read('components/dating/OneOnOneRefreshControl.tsx').includes('ONE_ON_ONE_REFRESH_POLICY_COPY'));
});

const controlSource = ast('components/dating/OneOnOneRefreshControl.tsx');
const controlFn = find(controlSource, n => ts.isFunctionDeclaration(n) && n.name?.text === 'OneOnOneRefreshControl');
const renderControl = evaluate('exports.render = ' + controlFn.getText(controlSource).replace('export default ', '') + ';', copy).render;
for (const remaining of [0, 1, 2]) test(`shared refresh control preserves quota, 44px target and policy: ${remaining}`, () => {
  const tree = renderControl({ usage: quota(remaining), busy: false, onRequest() {} });
  const button = nodes(tree).find(n => n.type === 'button');
  assert.equal(button.props.disabled, remaining === 0);
  assert.ok(button.props.className.includes('min-h-[44px]'));
  assert.match(text(tree), new RegExp(`${remaining}회 남음`));
  assert.ok(text(tree).includes(copy.ONE_ON_ONE_REFRESH_POLICY_COPY));
  assert.equal(nodes(tree).find(n => n.type === 'details').props.open, undefined);
  if (remaining === 0) assert.match(text(tree), /오후 11:56:36/);
  assert.equal(nodes(renderControl({ usage: quota(remaining), busy: true, onRequest() {} })).find(n => n.type === 'button').props.disabled, true);
  assert.equal(nodes(renderControl({ usage: quota(remaining), blocked: true, busy: false, onRequest() {} })).find(n => n.type === 'button').props.disabled, true);
});
test('unknown quota stays disabled; inline failure is an alert and success is a status', () => {
  assert.equal(nodes(renderControl({ busy: false, onRequest() {} })).find(n => n.type === 'button').props.disabled, true);
  for (const [kind, role] of [['error', 'alert'], ['success', 'status']]) {
    const tree = renderControl({ usage: quota(1), busy: false, notice: { kind, message: '한글 안내' }, onRequest() {} });
    assert.equal(nodes(tree).find(n => n.props?.role === role).props.children, '한글 안내');
  }
});
const plus = evaluate(read('components/dating/OneOnOnePlusStatus.tsx')).default;
test('compact Plus stays collapsed, formats KST expiry and preserves legacy exchange entitlement', () => {
  for (const included of [true, false]) {
    const tree = plus({ expiresAt: '2026-10-03T18:42:08.92441+00:00', contactExchangeIncluded: included });
    assert.equal(tree.type, 'details'); assert.equal(tree.props.open, undefined);
    assert.match(text(tree), /10\. 4\./);
    assert.match(text(tree), /(?:0?3:42:08|3시 42분 8초)/);
    assert.ok(text(tree).includes(included ? '번호교환이 포함' : '번호교환은 별도로'));
  }
  assert.ok(!text(plus({ expiresAt: 'invalid', contactExchangeIncluded: false })).includes('Invalid Date'));
});

test('confirmation hook rejects a second prompt and safely cancels a pending request on unmount', async () => {
  const hook = find(controlSource, n => ts.isFunctionDeclaration(n) && n.name?.text === 'useOneOnOneRefreshConfirmation');
  const cleanups = [];
  const run = evaluate('exports.run = ' + hook.getText(controlSource).replace('export ', '') + ';', {
    ...copy, useState: () => [null, () => {}], useRef: value => ({ current: value }), useId: () => 'fixture-id',
    useCallback: fn => fn, useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); },
  }).run;
  const result = run();
  const first = result.confirmOneOnOneRefresh(quota(2));
  assert.equal(await result.confirmOneOnOneRefresh(quota(2)), false);
  cleanups.forEach(cleanup => cleanup());
  assert.equal(await first, false);
  cleanups.forEach(cleanup => cleanup()); // repeated cleanup cannot accept or consume
});
