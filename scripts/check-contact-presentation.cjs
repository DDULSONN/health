/* eslint-disable @typescript-eslint/no-require-imports */
// Read-only local fixtures: no account, payment, message or production access.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react'), { renderToStaticMarkup: render } = require('react-dom/server');
const root = path.resolve(__dirname, '..'), read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, deps = {}) {
  const mod = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('module', 'exports', 'require', code)(mod, mod.exports, name => {
    if (Object.hasOwn(deps, name)) return deps[name];
    if (name.startsWith('@/')) {
      const target = name.slice(2);
      return load(target + (fs.existsSync(path.join(root, target + '.ts')) ? '.ts' : '.tsx'), deps);
    }
    return require(name);
  });
  return mod.exports;
}
const { groupContactPresentation: group, contactPresentationTime: time } = load('lib/dating-1on1-contact-presentation.ts');
const List = load('components/dating/OneOnOneContactList.tsx').default;
const NOW = Date.parse('2026-10-20T12:00:00Z'), DAY = 86400000;
const date = age => new Date(NOW - age * DAY).toISOString();
const match = (id, age, patch = {}) => ({ id, role: 'source', state: 'mutual_accepted', contact_exchange_status: 'none',
  source_final_responded_at: date(age), created_at: date(40), ...patch });

test('recent mutual acceptance, not request creation or unrelated updates, determines order', () => {
  const newestAcceptance = match('recent', 0, { created_at: date(40) });
  const newerRequest = match('older', 2, { created_at: date(2), updated_at: date(-1) });
  const input = Object.freeze([Object.freeze(newerRequest), Object.freeze(newestAcceptance)]);
  assert.deepEqual(group(input, NOW).current.map(x => x.id), ['recent', 'older']);
  assert.deepEqual(input.map(x => x.id), ['older', 'recent']);
  assert.equal(time(newerRequest), Date.parse(date(2)));
});

test('only genuine received available messages bring an old unpaid match forward', () => {
  const received = { available: true, received_from_other: { created_at: date(0) } };
  const recent = match('recent-accept', 1);
  const input = [match('new-message', 20, { contact_nudge: received }), recent,
    match('own-message', 20, { contact_nudge: { available: true, sent_by_me: { created_at: date(0) } } }),
    match('unavailable-message', 20, { contact_nudge: { ...received, available: false } }),
    match('stale-message', 20, { contact_nudge: { available: true, received_from_other: { created_at: date(8) } } })];
  const { current, older } = group(input, NOW);
  assert.deepEqual(current.map(x => x.id), ['new-message', 'recent-accept']);
  assert.deepEqual(new Set(older.map(x => x.id)), new Set(['own-message', 'unavailable-message', 'stale-message']));
});

test('seven-day boundary is exact and no item is lost or duplicated', () => {
  const input = [match('just-under', 7 - 1 / DAY), match('boundary', 7), match('older', 30)];
  const before = JSON.stringify(input), result = group(input, NOW);
  assert.deepEqual(result.current.map(x => x.id), ['just-under']);
  assert.deepEqual(result.older.map(x => x.id), ['boundary', 'older']);
  assert.equal(new Set([...result.current, ...result.older].map(x => x.id)).size, input.length);
  assert.equal(JSON.stringify(input), before);
});

test('missing/invalid acceptance timestamps are never silently folded; legacy candidate date is supported', () => {
  for (const value of [undefined, null, '', 'invalid']) {
    const item = match('unknown', 40, { source_final_responded_at: value });
    assert.equal(group([item], NOW).current.length, 1);
    assert.equal(group([{ ...item, candidate_responded_at: date(10) }], NOW).older.length, 1);
  }
  assert.equal(group([match('future', -1)], NOW).current.length, 1);
  assert.equal(group([match('invalid-now', 50)], NaN).current.length, 1);
});

test('approved, paid, canceled and unconfirmed states are never treated as old unpaid matches', () => {
  for (const state of ['mutual_accepted', 'candidate_accepted', 'source_selected', 'proposed', 'admin_canceled', undefined]) {
    for (const status of ['none', 'awaiting_applicant_payment', 'approved', 'paid', 'payment_pending_admin', 'canceled', 'unknown', undefined]) {
      const result = group([match('item', 40, { state, contact_exchange_status: status })], NOW);
      const folded = state === 'mutual_accepted' && ['none', 'awaiting_applicant_payment'].includes(status);
      assert.equal(result.older.length, Number(folded), `${state}/${status}`);
      assert.equal(result.current.length + result.older.length, 1);
    }
  }
});

test('equal or missing timestamps preserve source order without mutating records', () => {
  const input = [match('a', 1), match('b', 1), match('c', 1)];
  assert.deepEqual(group(input, NOW).current.map(x => x.id), ['a', 'b', 'c']);
  for (const item of input) { delete item.source_final_responded_at; delete item.created_at; }
  assert.deepEqual(group(input, NOW).current.map(x => x.id), ['a', 'b', 'c']);
});

test('collapsed old profiles do not mount payment, tracking or photo components; no effects on open', () => {
  const mounted = [];
  const input = [match('old', 0, { source_final_responded_at: '2020-01-01T00:00:00Z' }),
    match('current', 0, { source_final_responded_at: new Date().toISOString() })];
  const html = render(React.createElement(List, { matches: input, renderMatch: item => {
    mounted.push(item.id); return React.createElement('p', null, item.id);
  } }));
  assert.deepEqual(mounted, ['current']);
  assert.match(html, /이전 미교환 매칭 · 1건/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  const source = read('components/dating/OneOnOneContactList.tsx');
  assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|setInterval|onExchange|onNudge/);
  assert.match(source, /olderOpen \?/);
});

test('both full match surfaces share grouping and keep focused notification cards outside the collapsed list', () => {
  const home = read('components/dating/OneOnOneHomePanel.tsx'), my = read('app/mypage/page.tsx');
  assert.match(home, /OneOnOneContactList matches=\{ongoingMatches\}/);
  assert.match(my, /OneOnOneContactList matches=\{mutualAcceptedMatches.filter\(\(match\) => match.counterparty_card\)\}/);
  assert.match(home, /match.id !== focusedMatch\?\.id/);
  assert.match(home, /id="selected-one-on-one-match"/);
  const offer = read('components/dating/OneOnOneContactOffer.tsx');
  assert.ok(offer.indexOf('<ContactCarePanel') < offer.indexOf('<button ref={buttonRef}'));
  assert.equal((offer.match(/<ContactCarePanel/g) || []).length, 1);
  assert.match(read('components/dating/ContactCarePanel.tsx'), /교환권 지원은 증빙 검토·승인이 필요해요/);
});
