/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function evaluate(source, bindings = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', ...Object.keys(bindings), js)(mod.exports, ...Object.values(bindings));
  return mod.exports;
}
const copy = evaluate(read('lib/dating-1on1-action-copy.ts'));
test('received request shortcut only includes requests awaiting this candidate, never sent, closed or mutually accepted matches', () => {
  for (const role of ['source', 'candidate', undefined]) for (const state of ['proposed', 'source_selected', 'candidate_accepted', 'mutual_accepted', 'candidate_rejected', 'source_declined', 'source_skipped', 'admin_canceled', undefined]) {
    assert.equal(copy.isIncomingOneOnOneRequest({ role, state }), role === 'candidate' && state === 'source_selected');
  }
});
for (const [state, source, candidate] of [
  ['source_selected', '상대 응답 대기', '내 수락 대기'],
  ['candidate_accepted', '내 수락 대기', '상대 확인 대기'],
  ['candidate_rejected', '상대가 거절한 요청', '내가 거절한 요청'],
  ['source_declined', '내가 거절한 요청', '상대가 거절한 요청'],
  ['source_skipped', '내가 취소한 요청', '상대가 취소한 요청'],
]) test(`${state}: labels reflect viewer role, not the other member's role`, () => {
  assert.equal(copy.getOneOnOneMatchLabel({ state, role: 'source' }), source);
  assert.equal(copy.getOneOnOneMatchLabel({ state, role: 'candidate' }), candidate);
});
test('legacy unilateral acceptance never claims mutual acceptance; unknown state is neutral', () => {
  assert.equal(copy.getOneOnOneMatchLabel({ state: 'candidate_accepted' }), '수락 확인 대기');
  assert.equal(copy.getOneOnOneMatchLabel({ state: 'mutual_accepted' }), '서로 수락 완료');
  assert.equal(copy.getOneOnOneMatchLabel({ state: 'new-state' }), '진행 상태 확인');
});
test('summary separates requests, own confirmation, contact exchange and waiting without counting completed exchanges', () => {
  const rows = [
    { role: 'candidate', state: 'source_selected' }, { role: 'source', state: 'source_selected' },
    { role: 'source', state: 'candidate_accepted' }, { role: 'candidate', state: 'candidate_accepted' },
    { role: 'source', state: 'mutual_accepted', contact_exchange_status: 'awaiting_applicant_payment' },
    ...['approved', 'payment_pending_admin', 'paid', 'canceled'].map(contact_exchange_status => ({ state: 'mutual_accepted', contact_exchange_status })),
    { role: 'source', state: 'proposed' }, { role: 'candidate', state: 'proposed' },
    { role: 'candidate', state: 'candidate_rejected' }, { role: 'source', state: 'source_skipped' },
  ];
  const before = JSON.stringify(rows);
  const summary = copy.getOneOnOneActionSummary(rows);
  assert.deepEqual(summary.primary, { label: '받은 요청', count: 1 });
  assert.equal(summary.detail, '받은 요청 1건 · 내 수락 대기 1건 · 연락처 교환 대기 1건 · 상대 응답 대기 1건 · 상대 확인 대기 1건 · 추천받은 후보 1건');
  assert.ok(!summary.otherDetail.includes('받은 요청'));
  assert.equal(JSON.stringify(rows), before);
  assert.equal(copy.getOneOnOneActionSummary([]).detail, '대기 중인 요청 없음');
});
test('request success text handles Korean names, missing names and line breaks without saying contact is exposed', () => {
  assert.ok(copy.buildOneOnOneRequestSentMessage(' 하늘보리 ').startsWith('하늘보리님에게 매칭 요청을 보냈어요.'));
  assert.ok(copy.buildOneOnOneRequestSentMessage(null).startsWith('상대에게'));
  assert.ok(!copy.buildOneOnOneRequestSentMessage('가\n나').includes('\n'));
  assert.ok(!/결제|공개됐|수락했/.test(copy.buildOneOnOneRequestSentMessage('회원')));
});
function find(node, predicate) {
  if (predicate(node)) return node;
  let result;
  ts.forEachChild(node, child => { if (!result) result = find(child, predicate); });
  return result;
}
function initializer(source, name) {
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return find(ast, n => ts.isVariableDeclaration(n) && n.name.getText(ast) === name).initializer.getText(ast);
}
for (const surface of ['home', 'mypage']) {
  const file = surface === 'home' ? 'app/community/dating/cards/page.tsx' : 'app/mypage/page.tsx';
  const source = read(file);
  const autoName = surface === 'home' ? 'handleOneOnOneAutoSelect' : 'handleOneOnOneAutoRecommendationSelect';
  test(`${surface}: existing matching and payment request payloads are unchanged`, () => {
    const before = execFileSync('git', ['show', 'cff3189:' + file], { cwd: root, encoding: 'utf8' });
    for (const name of [autoName, 'handleOneOnOneMatchAction', surface === 'home' ? 'handleOneOnOneContactCheckout' : 'handleRequestOneOnOneContactExchange']) {
      const fetches = text => {
        const ast = ts.createSourceFile('handler.tsx', initializer(text, name), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const items = [];
        function visit(n) { if (ts.isCallExpression(n) && n.expression.getText(ast) === 'fetch') items.push(n.getText(ast).replace(/\r\n/g, '\n')); ts.forEachChild(n, visit); }
        visit(ast); return items;
      };
      assert.deepEqual(fetches(source), fetches(before));
    }
    assert.ok(!source.includes('이 후보 선택'));
  });
  for (const scenario of ['success', 'rejected', 'already-handled', 'network-error', 'read-failure']) {
    test(`${surface}: actual request handler notice is accurate for ${scenario}`, async () => {
      let notice = '이전 요청 성공 안내', posts = 0, reloads = 0;
      const alerts = [];
      const reload = async () => { reloads++; if (scenario === 'read-failure' && surface === 'mypage') throw Error('Read failed'); };
      const handler = evaluate('exports.handler = ' + initializer(source, autoName), {
        ...copy, useCallback: fn => fn, processingOneOnOneAutoKeys: [], setProcessingOneOnOneAutoKeys() {},
        setOneOnOneActionNotice: value => { notice = value; }, reloadOneOnOneHome: reload,
        reloadOneOnOneAfterAction: reload, reloadOneOnOneRecommendations: reload,
        alert: value => alerts.push(value), console: { error() {} },
        fetch: async (url, options) => {
          posts++; assert.equal(url, '/api/dating/1on1/matches/auto');
          assert.deepEqual(JSON.parse(options.body), { source_card_id: 'source', candidate_card_id: 'target' });
          if (scenario === 'network-error') throw Error('Network failed');
          const ok = !['rejected', 'already-handled'].includes(scenario);
          return { ok, json: async () => ({ ok, error: 'Request rejected', code: scenario === 'already-handled' ? 'CANDIDATE_ALREADY_HANDLED' : undefined }) };
        },
      }).handler;
      await handler('source', 'target', '테스트상대');
      assert.equal(posts, 1);
      if (['success', 'read-failure'].includes(scenario)) {
        assert.ok(notice.startsWith('테스트상대님에게 매칭 요청을 보냈어요.'));
        assert.equal(alerts.length, 0); assert.equal(reloads, 1);
      } else assert.equal(notice, '', 'failed POST cannot show a success notice');
    });
  }
  for (const ok of [true, false]) test(`${surface}: proposed request clears previous notice and only reports confirmed success (${ok})`, async () => {
    let notice = '이전 요청 성공 안내';
    const locks = new Set();
    const matches = [{ id: 'proposal', counterparty_card: { name: '새상대' } }];
    const handler = evaluate('exports.handler = ' + initializer(source, 'handleOneOnOneMatchAction'), {
      ...copy, useCallback: fn => fn, oneOnOneMatchActionLocksRef: { current: locks }, setProcessingOneOnOneMatchIds() {},
      oneOnOneHome: { matches }, myOneOnOneMatches: matches, setOneOnOneActionNotice: value => { notice = value; },
      reloadOneOnOneHome: async () => {}, reloadOneOnOneAfterAction: async () => {}, alert() {},
      fetch: async (url, options) => {
        assert.equal(notice, '', 'old success notice must be gone before POST');
        assert.equal(url, '/api/dating/1on1/matches/proposal');
        assert.deepEqual(JSON.parse(options.body), { action: 'select_candidate' });
        return { ok, status: ok ? 200 : 409, json: async () => ({ ok, error: 'Request rejected' }) };
      },
    }).handler;
    await handler('proposal', 'select_candidate');
    assert.equal(notice, ok ? copy.buildOneOnOneRequestSentMessage('새상대') : '');
    assert.equal(locks.size, 0);
  });
}
