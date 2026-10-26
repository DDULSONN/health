/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function handler(file, name, context) {
  const ast = ts.createSourceFile('view.tsx', read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let source;
  function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) source = node.initializer.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(source, name); context.useCallback = fn => fn; return vm.runInNewContext(compile('const run = ' + source + '; run;'), context);
}
const exportsFixture = {};
vm.runInNewContext(compile(read('lib/dating-ui-labels.ts')), { exports: exportsFixture });
for (const [status, label] of Object.entries({ public: '공개 중', pending: '공개 대기', expired: '공개 종료', hidden: '숨김', bad: '상태 확인 중' })) {
  test('member label only: ' + status, () => assert.equal(exportsFixture.openCardStatusLabel(status), label));
}
test('legacy page retains approved list reads and no new payment calls', () => {
  const source = read('app/dating/more-view/page.tsx');
  assert.match(source, /\/api\/dating\/cards\/more-view\/status/); assert.match(source, /\/api\/dating\/cards\/more-view\/list\?sex=/);
  assert.match(source, /state !== "approved"/); assert.match(source, /href="\/dating\/nearby-view"/);
  assert.doesNotMatch(source, /toss\/create|method: "POST"|requestCheckout/);
  assert.match(source, /!loading && !loadError &&/);
  const my = read('app/mypage/page.tsx');
  assert.match(my, /paymentCenterData.orders.some\(\(order\) => order.product_type === "more_view"\)/);
  assert.match(my, /openCardStatusLabel\(card.status\)/);
});
test('paid detail and application never send back navigation to purchase registration', () => {
  for (const file of ['app/dating/paid/[id]/page.tsx', 'app/dating/paid/[id]/apply/page.tsx']) {
    const source = read(file); assert.doesNotMatch(source, /(?:href=|router.replace\()"\/dating\/paid"/);
    assert.match(source, /\/community\/dating\/cards\?tab=open_cards/);
  }
  assert.match(read('app/dating/paid/[id]/apply/page.tsx'), /href=\{`\/dating\/paid\/\$\{id\}`\}/);
});
test('login copy changes no authentication actions and completion links remain application-specific', () => {
  assert.match(read('app/login/page.tsx'), /로그인하고 프로필과 매칭을 확인하세요/);
  for (const [file, anchor] of [['app/dating/paid/[id]/apply/page.tsx', 'paid-card-applied'], ['app/community/dating/cards/[id]/apply/page.tsx', 'open-card-applied']]) {
    const source = read(file); assert.ok(source.includes('historyHref="/mypage?section=matching&match=applied#' + anchor + '"'));
    assert.match(source, /setCompleted\(true\)/); assert.match(source, /completed \|\|/);
  }
  assert.match(read('components/dating/ApplicationCompleteNotice.tsx'), /heading.current\?\.focus\(\)/);
});
function checkout(overrides = {}) {
  const state = {}, writes = [], lock = { current: false };
  const context = { submitting: false, checkoutLock: lock, supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'local-token' } } }) } },
    URLSearchParams, JSON, window: { location: { search: '?returnTo=%2Fcommunity%2Fdating%2Fcards%2Ffake%2Fapply', href: '' } },
    normalizeDatingApplyReturn: v => v, withPaymentCardNotice: v => v + ' 카드 안내', setSubmitting: v => { state.busy = v; }, setCheckoutError: v => { state.error = v; },
    fetch: async (url, options) => { writes.push({ url, options }); return { ok: false, json: async () => ({ message: '실패' }) }; }, ...overrides };
  return { state, writes, lock, context, run: handler('app/dating/apply-credits/page.tsx', 'handleCheckout', context) };
}
test('credits retains product, authorization and application return path, never client amount', async () => {
  const f = checkout(); await f.run(); const w = f.writes[0];
  assert.equal(w.url, '/api/payments/toss/create'); assert.equal(w.options.headers.Authorization, 'Bearer local-token');
  assert.deepEqual(JSON.parse(w.options.body), { productType: 'apply_credits', returnTo: '/community/dating/cards/fake/apply' });
  assert.equal(f.state.error, '실패 카드 안내'); assert.equal(f.state.busy, false); assert.equal(f.lock.current, false);
});
for (const body of [{}, { ok: false, checkoutUrl: '/never' }]) test('invalid checkout response does not navigate: ' + JSON.stringify(body), async () => {
  const f = checkout({ fetch: async () => ({ ok: true, json: async () => body }) }); await f.run(); assert.equal(f.context.window.location.href, ''); assert.ok(f.state.error); assert.equal(f.lock.current, false);
});
test('network failure and missing session unlock without redirect', async () => {
  for (const overrides of [{ fetch: async () => { throw Error('offline'); } }, { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }]) {
    const f = checkout(overrides); await f.run(); assert.ok(f.state.error); assert.equal(f.context.window.location.href, ''); assert.equal(f.lock.current, false);
  }
});
test('simultaneous checkout makes one request and valid response keeps checkout redirect', async () => {
  let resolve; const wait = new Promise(r => { resolve = r; }); const f = checkout();
  f.context.fetch = async (url, options) => { f.writes.push({ url, options }); await wait; return { ok: true, json: async () => ({ ok: true, checkoutUrl: '/local-checkout' }) }; };
  const first = f.run(); await Promise.resolve(); await f.run(); assert.equal(f.writes.length, 1); resolve(); await first;
  assert.equal(f.context.window.location.href, '/local-checkout');
});
function openSubmit(response) {
  const state = {}, writes = [];
  const context = { completed: false, submitting: false, creditCheckoutInFlightRef: { current: false }, photoPreparation: { isProcessing: () => false },
    normalizeInstagramId: v => v, validInstagramId: () => true, instagramId: 'fixture', consent: true, photos: [], reuseLastPhotos: true,
    lastApplication: { photo_paths: ['own/one', 'own/two'] }, uploadedPathsRef: { current: [] }, id: 'fixture-card', age: '30', heightCm: '175', region: '서울', job: '회사원', trainingYears: '2', introText: '기존 지원 글',
    JSON, Number, setError: v => { state.error = v; }, setErrorCode() {}, setProfileEditUrl() {}, setSubmitting: v => { state.busy = v; }, setCompleted: v => { state.completed = v; },
    clearApplyCheckoutDraft: () => { state.cleared = true; }, window: { sessionStorage: {} }, viewerIdRef: { current: 'fixture' },
    fetch: async (url, options) => { writes.push({ url, options }); return { ok: true, json: async () => response }; } };
  return { state, writes, run: handler('app/community/dating/cards/[id]/apply/page.tsx', 'handleSubmit', context) };
}
for (const body of [null, {}, { ok: false }, { ok: 'true' }, { ok: true }]) test('open application only explicit success clears draft: ' + JSON.stringify(body), async () => {
  const f = openSubmit(body); await f.run({ preventDefault() {} });
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].url, '/api/dating/cards/apply');
  assert.deepEqual(JSON.parse(f.writes[0].options.body).photo_paths, ['own/one', 'own/two']);
  assert.equal(Boolean(f.state.completed), body?.ok === true); assert.equal(Boolean(f.state.cleared), body?.ok === true);
  if (body?.ok !== true) assert.match(f.state.error, /내 지원/);
});
