/* eslint-disable @typescript-eslint/no-require-imports */
// Offline UI regression: display changes must preserve existing match/payment callbacks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const tree = code => ts.createSourceFile('view.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function canonical(node, ast, omitClasses = false) {
  const result = ts.transform(node, [ctx => function visit(n) {
    if (omitClasses && ts.isJsxAttribute(n) && n.name.getText(ast) === 'className') return undefined;
    return ts.visitEachChild(n, visit, ctx);
  }]);
  const text = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, result.transformed[0], ast).replace(/\s+/g, ' ').trim();
  result.dispose(); return text;
}
function fingerprint(code, name) {
  code = code.replaceAll('(matchId: string, offerId?: string) => void', '(matchId: string) => void');
  const ast = tree(code), fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn); return hash(canonical(fn, ast, true));
}
function panelContract(code) {
  const ast = tree(code), fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'OneOnOneHomePanel');
  const bindings = {}, callbacks = [], disabled = [];
  function visit(n) {
    if (ts.isVariableDeclaration(n) && ['activeMatches', 'recommendationGroups', 'recommendationCount', 'activeCards', 'incomingRequests', 'sortedMatches', 'plusActive', 'plusContactExchangeIncluded'].includes(n.name.getText(ast))) bindings[n.name.getText(ast)] = hash(canonical(n, ast));
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText(ast), text = canonical(n, ast);
      if (/^on[A-Z]/.test(name) && !/jumpTo(Profile|Section|MatchSummary)/.test(text)) callbacks.push(text);
      if (name === 'disabled' && !text.includes('shortcutsDisabled')) disabled.push(text);
    }
    ts.forEachChild(n, visit);
  }
  visit(fn); return { bindings, callbacks: callbacks.sort(), disabled: disabled.sort() };
}
const files = {
  OneOnOneCandidateCard: 'components/dating/OneOnOneHomePanel.tsx',
  OneOnOneMatchActions: 'components/dating/OneOnOneHomePanel.tsx',
  OneOnOneContactOffer: 'components/dating/OneOnOneContactOffer.tsx',
  OneOnOneIncomingRequests: 'components/dating/OneOnOneIncomingRequests.tsx',
};
// Export the read-only canonicalizer for generating a pinned baseline from git show.
module.exports = { fingerprint, panelContract, files };
if (require.main === module) {
  const baseline = JSON.parse(read('scripts/fixtures/one-on-one-ui-contract.json'));
  for (const [name, file] of Object.entries(files)) test('reviewed view contract: ' + name, () => {
    // Reviewed CTA separates its visible, aria-describedby-linked price below the button.
    // Quote/dispatch, disabled states and free benefits are unchanged; conversion tests
    // assert full/compact prices, unique descriptions and existing payment callbacks.
    const expected = name === 'OneOnOneContactOffer'
      ? '22bca1832e0b0b35c8bffa45c87d7108d12b73bf2206dcae9083c930ce6396ef'
      // Same article/children/buttons, with a visibility-only observation hook.
      : name === 'OneOnOneCandidateCard' ? '31f6f4a089163a4631d1cd45be6017b561e93e9a69114a68d27ad2927a07d6e3' : baseline.functions[name];
    let source = read(file);
    if (name === 'OneOnOneCandidateCard') {
      // The small, read-only region notice is tested separately. Keep the
      // original card/photo/action fingerprint pinned around that one addition.
      const notice = '              <OneOnOneCandidateRegionNotice widened={card?.recommendation_region_widened} />\n';
      assert.equal(source.split(notice).length, 2);
      source = source.replace(notice, '');
    }
    if (name === 'OneOnOneContactOffer') {
      // Only the reviewed, read-on-open support guide may be added. Keep the
      // original payment callback/price/disabled-state fingerprint unchanged.
      const guide = '      {!included ? <ContactCarePanel key={matchId} matchId={matchId} guideOnly /> : null}\n';
      assert.equal(source.split(guide).length, 2);
      source = source.replace(guide, '');
    }
    assert.equal(fingerprint(source, name), expected);
  });
  test('recommendation ordering, counters and existing action bindings remain unchanged', () => {
    // The resilience patch adds one explicit, GET-only recommendation retry.
    const expected = { ...baseline.panel, callbacks: [...baseline.panel.callbacks, 'onClick={onReload}', 'onExchange={onContactCheckout}', 'onNudge={onContactNudge}'].sort() };
    assert.deepEqual(panelContract(read(files.OneOnOneCandidateCard)), expected);
  });
  test('candidate section is before profile/plus/sent history, after incoming requests', () => {
    const source = read(files.OneOnOneCandidateCard);
    const positions = ['next-steps', 'incoming', 'recommendations', 'profile', 'matches'].map(section => source.indexOf(`data-one-on-one-section="${section}"`));
    assert.ok(positions.every(p => p > 0));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions);
    assert.ok(source.indexOf('<OneOnOnePlusStatus ') > positions[2], 'plus remains available below candidates');
  });
  test('shortcuts keep URL and network untouched and disable while data is uncertain', () => {
    const source = read(files.OneOnOneCandidateCard);
    const ast = tree(source); const shortcuts = [];
    function visit(n) { if (ts.isFunctionDeclaration(n) && /^jumpTo/.test(n.name?.text || '')) shortcuts.push(n.getText(ast)); ts.forEachChild(n, visit); }
    visit(ast); assert.equal(shortcuts.length, 3);
    const code = shortcuts.join('\n');
    assert.doesNotMatch(code, /fetch|onMatchAction|onContactCheckout|onAutoSelect|onRefreshRecommendations|history\.|location\./);
    assert.match(code, /open = true/); assert.match(code, /preventScroll: true/);
    assert.match(source, /shortcutsDisabled = loading \|\| sessionError \|\| Boolean\(error\)/);
    assert.equal((source.match(/disabled=\{shortcutsDisabled\}/g) || []).length, 3);
  });
  test('photos retain their size, full-image links and rendering settings', () => {
    const source = read(files.OneOnOneCandidateCard);
    assert.ok(source.includes('h-[104px] w-[92px]'));
    assert.ok(source.includes('relative block h-24 overflow-hidden'));
    assert.ok(source.includes('compact ? "grid-cols-2" : "grid-cols-3"'));
    assert.equal((source.match(/loading="lazy"/g) || []).length, 4);
  });
  test('match action controls have at least 44px height and clear primary/secondary styles', () => {
    const source = read(files.OneOnOneCandidateCard);
    const actions = source.slice(source.indexOf('function OneOnOneMatchActions('));
    assert.ok(!actions.includes('min-h-[34px]'));
    assert.ok(!actions.includes('bg-sky-600') && !actions.includes('bg-emerald-600'));
    assert.ok(actions.includes('bg-[#f0003d]'));
    assert.ok(read(files.OneOnOneContactOffer).includes('min-h-[44px] w-full'));
  });
}
