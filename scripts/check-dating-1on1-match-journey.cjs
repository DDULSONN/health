/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic state only: never contacts production, a payment provider, or sends messages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup: render } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const Link = ({ children, href, ...props }) => React.createElement('a', { href, ...props }, children);
function evaluate(source, deps = {}) {
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('module', 'exports', 'require', compiled)(module, module.exports, name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (['react', 'react/jsx-runtime'].includes(name)) return require(name);
    if (name === 'next/link') return { default: Link };
    throw Error('Unexpected dependency: ' + name);
  });
  return module.exports;
}
const nav = evaluate(read('lib/dating-1on1-match-navigation.ts'));
const id = '01234567-abcd-4000-8000-012345678901';
const deps = { '@/lib/dating-1on1-match-navigation': nav };
const Steps = evaluate(read('components/dating/OneOnOneNextSteps.tsx'), deps).default;
const Pending = evaluate(read('components/dating/OneOnOneContactPending.tsx')).default;
const Inbox = evaluate(read('components/dating/OneOnOneIncomingRequests.tsx')).default;

test('deep links accept only a UUID; malformed links always fall back to the 1:1 tab', () => {
  assert.equal(nav.normalizeOneOnOneMatchId(id.toUpperCase()), id);
  assert.equal(nav.oneOnOneMatchHref(id), `/community/dating/cards?tab=one_on_one&matchId=${id}#selected-one-on-one-match`);
  for (const value of [null, undefined, '', '//evil.test', `${id}&action=accept`, `${id}/`, ` ${id}`, 3, {}, '<script>']) {
    assert.equal(nav.normalizeOneOnOneMatchId(value), null);
    assert.equal(nav.oneOnOneMatchHref(value), '/community/dating/cards?tab=one_on_one');
  }
  assert.equal(nav.oneOnOneNotificationHref('comment', id), null);
  assert.equal(nav.oneOnOneNotificationHref('dating_1on1_recommendations', id), null);
  assert.equal(nav.oneOnOneNotificationHref('dating_1on1_match_accepted', 'invalid'), null);
});

test('only mutual unpaid states offer contact exchange; uncertain/completed/closed states never do', () => {
  for (const state of ['proposed', 'source_selected', 'candidate_accepted', 'mutual_accepted', 'candidate_rejected', 'admin_canceled', undefined]) {
    for (const contact_exchange_status of ['none', 'awaiting_applicant_payment', 'paid', 'approved', 'payment_pending_admin', 'canceled', 'unexpected', undefined]) {
      assert.equal(nav.canOfferOneOnOneContact({ state, contact_exchange_status }),
        state === 'mutual_accepted' && ['none', 'awaiting_applicant_payment'].includes(contact_exchange_status));
    }
  }
});

test('compact next steps show only actionable matches, not waiting or already exchanged members', () => {
  const matches = [
    { id, role: 'source', state: 'candidate_accepted', counterparty_card: { name: '확인할상대' } },
    { id: id.replace(/1$/, '2'), role: 'candidate', state: 'mutual_accepted', contact_exchange_status: 'awaiting_applicant_payment', counterparty_card: { name: '교환할상대' } },
    ...['approved', 'paid', 'payment_pending_admin', 'canceled'].map((status, i) => ({ id: String(i), state: 'mutual_accepted', contact_exchange_status: status, counterparty_card: { name: `숨길상대${i}` } })),
    { id: 'none', role: 'candidate', state: 'candidate_accepted', counterparty_card: { name: '상대확인대기' } },
    { id: 'missing', state: 'mutual_accepted', contact_exchange_status: 'none' },
  ];
  const html = render(React.createElement(Steps, { matches }));
  assert.ok(html.includes('확인할상대')); assert.ok(html.includes('교환할상대'));
  assert.ok(!html.includes('숨길상대')); assert.ok(!html.includes('상대확인대기'));
  assert.ok(html.includes('수락 여부 확인')); assert.ok(html.includes('연락처 교환'));
  assert.ok(!html.includes('<img')); assert.ok(!html.includes('fetch'));
  assert.equal(render(React.createElement(Steps, { matches: [] })), '');
});

test('received requests start open but mount only three actionable profiles', () => {
  const html = render(React.createElement(Inbox, { requests: Array.from({ length: 10 }, (_, i) => ({ id: String(i) })),
    renderRequest: row => React.createElement('p', null, `요청프로필${row.id}`) }));
  assert.ok(html.includes('aria-expanded="true"'));
  assert.equal((html.match(/요청프로필/g) || []).length, 3);
  assert.ok(html.includes('받은 요청 더보기 · 7건'));
});

test('uncertain payment states only provide history navigation, never a pay button', () => {
  for (const status of ['paid', 'payment_pending_admin', 'canceled', 'unknown']) {
    const html = render(React.createElement(Pending, { status }));
    assert.ok(!html.includes('<button')); assert.ok(!html.includes('20,000'));
    if (status !== 'canceled') assert.ok(html.includes('/mypage?section=payment'));
  }
});

test('new names remain escaped and bounded layout remains wrapping', () => {
  const html = render(React.createElement(Steps, { matches: [{ id, state: 'mutual_accepted', contact_exchange_status: 'none', counterparty_card: { name: '<script>한글</script>' } }] }));
  assert.ok(html.includes('&lt;script&gt;한글')); assert.ok(!html.includes('<script>')); assert.ok(html.includes('break-words'));
});

test('successful confirmation only adds an owner-scoped navigation field; all approval/fulfillment code is unchanged', () => {
  const source = read('app/api/payments/toss/confirm/route.ts');
  const fields = source.match(/^[ \t]*matchId: order\.product_type === "one_on_one_contact_exchange"\n[ \t]*\? normalizeOneOnOneMatchId\(order\.product_meta\?\.matchId\) \?\? normalizeOneOnOneMatchId\(order\.product_ref_id\) : undefined,\n/gm);
  assert.equal(fields?.length, 2, 'both new and already-confirmed payment responses keep the destination');
  const withoutNavigation = source.replace('import { normalizeOneOnOneMatchId } from "@/lib/dating-1on1-match-navigation";\n', '')
    .replace(/^[ \t]*matchId: order\.product_type === "one_on_one_contact_exchange"\n[ \t]*\? normalizeOneOnOneMatchId\(order\.product_meta\?\.matchId\) \?\? normalizeOneOnOneMatchId\(order\.product_ref_id\) : undefined,\n/gm, '');
  assert.equal(crypto.createHash('sha256').update(withoutNavigation).digest('hex'), '149d69aa46a589562084bd0c0f01e1c612c00211ea2cfed5e0c5bdcaf6cb0172');
});

test('payment success returns to the confirmed match, not an untrusted URL match ID', () => {
  const source = read('app/payments/success/page.tsx');
  const ast = ts.createSourceFile('success.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'getPrimaryAction');
  const { getPrimaryAction } = evaluate(`const {oneOnOneMatchHref} = require('nav'); export ${fn.getText(ast)}`, { nav });
  assert.equal(getPrimaryAction('one_on_one_contact_exchange', null, null, id).href, nav.oneOnOneMatchHref(id));
  assert.equal(getPrimaryAction('one_on_one_contact_exchange').href, nav.oneOnOneMatchHref(null));
  assert.match(source, /getPrimaryAction\(result\?\.productType, result\?\.orderName, searchParams.get\("province"\), result\?\.matchId\)/);
  assert.ok(!source.includes('searchParams.get("matchId")'));
  assert.match(read('components/dating/ContactPaymentRecovery.tsx'), /oneOnOneMatchHref\(recovery.matchId\)/);
});

test('a signed-out SMS recipient keeps the matching tab through the existing login redirect', async () => {
  const file = read('app/mypage/page.tsx');
  const ast = ts.createSourceFile('mypage.tsx', file, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('/api/mypage/summary?profileOnly=1')) effect = node.arguments[0].getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(effect);
  const js = ts.transpileModule('const effect = ' + effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const [search, hash] of [['?section=matching', ''], ['?section=matching&match=one_on_one', '#one-on-one-status']]) {
    let destination, calls = 0;
    const bindings = { window: { location: { search, hash } }, router: { replace: href => { destination = href; } },
      fetch: async path => { calls++; assert.equal(path, '/api/mypage/summary?profileOnly=1'); return Response.json({}, { status: 401 }); },
      setLoading() {}, setError(error) { throw Error(error); } };
    const cleanup = new Function(...Object.keys(bindings), js + ';return effect();')(...Object.values(bindings));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(destination, '/login?redirect=' + encodeURIComponent('/mypage' + search + hash));
    assert.equal(calls, 1); cleanup();
  }
});
