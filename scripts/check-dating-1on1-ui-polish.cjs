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
  code = name === 'OneOnOneContactOffer'
    ? require('./fixtures/private-contact-contract.cjs').withoutPrivateAdditions(code, files.OneOnOneContactOffer)
    : require('./fixtures/private-contact-contract.cjs').withoutPrivateView(code);
  code = code.replaceAll('(matchId: string, offerId?: string) => void', '(matchId: string) => void');
  const ast = tree(code), fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn); return hash(canonical(fn, ast, true));
}
// Pin non-visual payment setup and the actual checkout button separately from
// legitimate greeting layout/copy changes. Never baseline a changed payment path.
function paymentContract(code) {
  code = require('./fixtures/private-contact-contract.cjs').withoutPrivateAdditions(code, files.OneOnOneContactOffer);
  const ast=tree(code),fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='OneOnOneContactOffer');
  const parts=fn.body.statements.filter(n=>!ts.isReturnStatement(n)).map(n=>canonical(n,ast));
  function visit(n){
    if(ts.isJsxOpeningElement(n)&&n.tagName.getText(ast)==='button'&&n.attributes.properties.some(p=>ts.isJsxAttribute(p)&&p.name.getText(ast)==='ref'&&p.initializer?.getText(ast)==='{buttonRef}'))parts.push(canonical(n,ast,true));
    ts.forEachChild(n,visit);
  }
  visit(fn);return hash(parts.join('\n'));
}
function panelContract(code) {
  code = require('./fixtures/love-pass-payment-contract.cjs').withoutSingleCandidatePanelChanges(code);
  const ast = tree(code), fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'OneOnOneHomePanel');
  const bindings = {}, callbacks = [], disabled = [];
  function visit(n) {
    if (ts.isVariableDeclaration(n) && ['activeMatches', 'recommendationGroups', 'recommendationCount', 'activeCards', 'incomingRequests', 'ongoingMatches', 'plusActive', 'plusContactExchangeIncluded'].includes(n.name.getText(ast))) bindings[n.name.getText(ast)] = hash(canonical(n, ast));
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
module.exports = { fingerprint, paymentContract, panelContract, files };
if (require.main === module) {
  const baseline = JSON.parse(read('scripts/fixtures/one-on-one-ui-contract.json'));
  for (const [name, file] of Object.entries(files)) test('reviewed view contract: ' + name, () => {
    // Reviewed mutual-acceptance-first layout and optional greeting/reply copy.
    // Payment setup/dispatch is pinned independently below; conversion tests
    // also assert prices, disabled states, included benefits and lazy guide reads.
    const expected = name === 'OneOnOneContactOffer'
      ? '12171b81d91fed7abe842e97eb22a4d55f776a43a67d23d4b4e1064c623926bc'
      // Same article/children/buttons, with a visibility-only observation hook.
      // Same photo links and action children; all profile text uses the shared disclosure.
      : name === 'OneOnOneCandidateCard' ? 'df450bedb6bb31ceffe30d1943dc946e291163ff620576355e9d02771474b61c'
      // Reviewed sender label/copy only; expand, pagination and accept/reject
      // children are exercised by participation SSR and actual-page tests.
      : name === 'OneOnOneIncomingRequests' ? '4f91d61efa993394937b165da22838d88a24ff3d08cedb756275f92e5322e9d1' : baseline.functions[name];
    let source = read(file);
    if (name === 'OneOnOneCandidateCard') {
      // The small, read-only region notice is tested separately. Keep the
      // original card/photo/action fingerprint pinned around that one addition.
      const notice = '              <OneOnOneCandidateRegionNotice widened={card?.recommendation_region_widened} />\n';
      assert.equal(source.split(notice).length, 2);
      source = source.replace(notice, '');
    }
    assert.equal(fingerprint(source, name), expected);
  });
  test('greeting redesign preserves the original payment setup and dispatch contract', () => {
    assert.equal(paymentContract(read(files.OneOnOneContactOffer)), '47f394e88a5bbd161a1ed53e52be7445178519c1a917c9be26487fd60057a425');
  });
  test('recommendation ordering, counters and existing action bindings remain unchanged', () => {
    // Read-only retries include the explicit stale-quota check; all mutation
    // callbacks, candidate ordering and checkout bindings remain pinned.
    // Only existing-match presentation moves to the shared list. Recommendation
    // inputs, incoming-request filters and all mutation callbacks remain pinned.
    const bindings = { ...baseline.panel.bindings };
    delete bindings.sortedMatches;
    bindings.ongoingMatches = '6075d5c6d7c23c49f35cb64c2cc68a8d93403a1ca5a3088d8203d4898664eb92';
    // Reviewed private-hide filter excludes only unsent admin proposals.
    // check-home-candidate-hides executes it against incoming/sent/paid states.
    bindings.activeMatches = '97d0aadcc8c126739a2bd9517c464ed7e8f06d6cd02837f0d078222ebb8033e7';
    const expected = { ...baseline.panel, bindings, callbacks: [
      ...baseline.panel.callbacks.filter((callback, index, callbacks) =>
        callback !== 'onClick={() => setVisibleMatchCount((count) => count + 8)}' &&
        (callback !== 'onClick={() => onAutoSelect(sourceCardId, candidateId, candidate.name)}' || callbacks.indexOf(callback) === index)),
      'onClick={onReload}', 'onCheckUsage={onReload}', 'onExchange={onContactCheckout}', 'onNudge={onContactNudge}',
      // Profile-only retry never invokes checkout or consumes a refresh.
      'onClick={onReload}',
      ...Array(3).fill('onHidden={onCandidateHidden}'), 'onRestored={onCandidateRestored}',
      // Reviewed saved-candidate actions reuse the existing matching callback.
      'onClick={() => onAutoSelect(sourceCardId, candidateId, card.name)}',
      'onClick={() => setAllCandidatesVisible(true)}',
      'onClick={() => setCandidateView(null)}',
      ...Array(2).fill('onBusyChange={value => favoriteBusy(sourceCardId, candidateId, value)}'),
      'onUpdated={() => onFavoriteChanged(sourceCardId, candidateId, !group.favorite_candidates?.some(card => card.id === candidateId))}',
      'onUpdated={() => onFavoriteChanged(sourceCardId, candidateId, false)}',
    ].sort(), disabled: [...baseline.panel.disabled.slice(0, 1).map(value => value === 'disabled={!canSelect || processingAutoKeys.includes(actionKey)}'
      ? 'disabled={!canSelect || processingAutoKeys.includes(actionKey) || favoriteBusyKeys.includes(actionKey)}' : value),
      'disabled={!canSelect || refreshing || processingAutoKeys.length > 0}',
      'disabled={!canSelect || refreshing || processingAutoKeys.includes(actionKey) || favoriteBusyKeys.includes(actionKey)}',
      ...Array(2).fill('disabled={busy}'),
      'disabled={processingMatchIds.includes(match.id) || refreshingRecommendationIds.length > 0}',
    ].sort() };
    assert.deepEqual(panelContract(read(files.OneOnOneCandidateCard)), expected);
    assert.match(read(files.OneOnOneCandidateCard), /initialVisibleCount=\{ONE_ON_ONE_HOME_VISIBLE_MATCHES\} pageSize=\{8\}/);
    assert.match(read('lib/dating-1on1-mobile-action.ts'), /ONE_ON_ONE_HOME_VISIBLE_MATCHES = 8/);
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
