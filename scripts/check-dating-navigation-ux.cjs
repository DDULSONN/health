/* eslint-disable @typescript-eslint/no-require-imports */
// Offline only: real React markup with service-free adapters. Never calls member APIs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function evaluate(source, deps = {}) {
  const mod = { exports: {} };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', output)(id => id in deps ? deps[id] : require(id), mod, mod.exports);
  return mod.exports;
}
const nav = evaluate(read('lib/dating-navigation.ts'));
const homeFile = 'app/community/dating/cards/page.tsx';
const mypageFile = 'app/mypage/page.tsx';
const home = read(homeFile), mypage = read(mypageFile);
function ast(source) { return ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function fetchCalls(source) {
  const tree = ast(source), calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'fetch') calls.push(node.getText(tree).replace(/\r\n/g, '\n'));
    ts.forEachChild(node, visit);
  };
  visit(tree); return calls;
}
for (const pathname of ['/dating/1on1', '/dating/1on1/example']) test(`existing 1:1 form stays under 1:1 navigation: ${pathname}`, () => {
  assert.equal(nav.isOneOnOneDestination(pathname, null), true);
});
for (const tab of [null, 'open_cards', 'quick_match', 'love_fortune', 'one_on_one', 'invalid']) test(`home navigation selection: ${tab}`, () => {
  assert.equal(nav.isOneOnOneDestination('/community/dating/cards', tab), tab === 'one_on_one');
  assert.equal(nav.isOneOnOneDestination('/community/dating/cards/card-id', tab), false);
});
for (const view of ['all', 'received', 'applied', 'one_on_one', 'quick']) {
  for (const group of ['received', 'applied', 'one_on_one', 'quick']) test(`empty/filled matching groups: ${view}/${group}`, () => {
    assert.equal(nav.showMatchingGroup(view, group, 0), view !== 'all' && view === group);
    assert.equal(nav.showMatchingGroup(view, group, 3), view === 'all' || view === group);
  });
}
function Link({ children, ...props }) { return React.createElement('a', props, children); }
for (const tab of ['open_cards', 'one_on_one', 'quick_match']) test(`real bottom navigation markup: ${tab}`, () => {
  const Component = evaluate(read('components/MobileBottomTabBar.tsx'), {
    'next/link': { default: Link },
    'next/navigation': { usePathname: () => '/community/dating/cards', useSearchParams: () => new URLSearchParams({ tab }) },
    '@/lib/dating-navigation': nav,
  }).default;
  const markup = renderToStaticMarkup(React.createElement(Component));
  assert.equal((markup.match(/aria-current="page"/g) || []).length, 1);
  const activeHref = tab === 'one_on_one' ? nav.ONE_ON_ONE_HOME_HREF : nav.OPEN_CARDS_HOME_HREF;
  assert.ok(markup.includes(`href="${activeHref}" aria-current="page"`));
  assert.ok(markup.includes(`href="${nav.ONE_ON_ONE_HOME_HREF}"`));
});
for (const tab of ['open_cards', 'one_on_one', 'quick_match']) test(`desktop and mobile header share the same destination: ${tab}`, () => {
  const Component = evaluate(read('components/Header.tsx'), {
    'next/link': { default: Link }, 'next/image': { default: props => React.createElement('img', { src: props.src, alt: props.alt }) },
    'next/dynamic': { default: () => () => null },
    'next/navigation': { usePathname: () => '/community/dating/cards', useSearchParams: () => new URLSearchParams({ tab }) },
    '@/lib/dating-navigation': nav,
  }).default;
  const markup = renderToStaticMarkup(React.createElement(Component));
  const activeHref = tab === 'one_on_one' ? nav.ONE_ON_ONE_HOME_HREF : nav.OPEN_CARDS_HOME_HREF;
  assert.ok(markup.includes(`href="${activeHref}" aria-current="page"`));
  assert.ok(!markup.includes('href="/dating/1on1"'));
});
const homeTree = ast(home);
let urlEffect;
function findUrlEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(homeTree) === 'useEffect' && node.arguments[0]?.getText(homeTree).includes('const requestedTab =')) urlEffect = node.arguments[0];
  ts.forEachChild(node, findUrlEffect);
}
findUrlEffect(homeTree);
for (const search of ['?tab=one_on_one', '?tab=open_cards', '?tab=quick_match', '', '?tab=invalid', '?tab=one_on_one&from=onboarding#one-on-one-candidates']) test(`actual URL effect handles refresh/back/forward state: ${search}`, () => {
  const url = new URL('https://fixture.invalid/community/dating/cards' + search);
  let selected, arrived = false, replacement;
  const run = evaluate(`const {window, setHomeFeatureTab, setArrivedFromDatingOnboarding, parseHomeFeatureTab} = require('fixture'); module.exports = ${urlEffect.getText(homeTree)};`, {
    fixture: {
      window: { location: { href: url.href }, history: { state: { __NA: true }, replaceState(state, unused, target) { assert.equal(state, null); replacement = target; } } },
      setHomeFeatureTab: value => { selected = value; }, setArrivedFromDatingOnboarding: value => { arrived = value; },
      parseHomeFeatureTab: value => ['open_cards', 'one_on_one', 'quick_match', 'love_fortune'].includes(value) ? value : null,
    },
  });
  run();
  assert.equal(selected, ['open_cards', 'one_on_one', 'quick_match'].includes(url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'open_cards');
  if (url.searchParams.has('from')) {
    assert.equal(arrived, true);
    assert.equal(replacement, '/community/dating/cards?tab=one_on_one#one-on-one-candidates');
  } else assert.equal(replacement, undefined);
});
const panel = homeTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'OneOnOneHomePanel');
const panelSource = `const {useState} = require('react');
const Link = require('next/link');
const ONE_ON_ONE_HOME_HREF = ${JSON.stringify(nav.ONE_ON_ONE_HOME_HREF)};
const buildLoginRedirect = path => '/login?redirect=' + encodeURIComponent(path);
${panel.getText(homeTree)}
module.exports = OneOnOneHomePanel;`;
const Panel = evaluate(panelSource, { 'next/link': Link });
const panelProps = { arrivedFromOnboarding: false, viewerLoggedIn: true, loading: false, error: '', data: { myCards: [] },
  profileStartHref: '/onboarding/dating', profileStartCta: '프로필 작성하기',
  processingMatchIds: [], processingContactIds: [], processingNudgeIds: [], processingAutoKeys: [], refreshingRecommendationIds: [] };
for (const label of ['프로필 작성하기', '이어서 작성하기', '휴대폰 인증하기']) test(`one clear profile action: ${label}`, () => {
  const markup = renderToStaticMarkup(React.createElement(Panel, { ...panelProps, profileStartCta: label }));
  assert.equal((markup.match(/href="\/onboarding\/dating"/g) || []).length, 1);
  assert.ok(markup.includes(label));
  assert.ok(!markup.includes('href="/dating/1on1"'));
});
test('guest login returns to selected 1:1 tab', () => {
  const markup = renderToStaticMarkup(React.createElement(Panel, { ...panelProps, viewerLoggedIn: false }));
  assert.ok(markup.includes(encodeURIComponent(nav.ONE_ON_ONE_HOME_HREF)));
  assert.ok(!markup.includes('href="/onboarding/dating"'));
});
test('unresolved authentication shows loading, not a premature login prompt', () => {
  const markup = renderToStaticMarkup(React.createElement(Panel, { ...panelProps, viewerLoggedIn: false, loading: true }));
  assert.ok(markup.includes('1대1 정보를 불러오는 중'));
  assert.ok(!markup.includes('로그인하기'));
  assert.match(home, /loading=\{!viewerSessionReady \|\| oneOnOneHomeLoading\}/);
});
test('initial rendering reads the selected tab before effects run', () => {
  assert.match(home, /useState<HomeFeatureTab>\(\s*\(\) => parseHomeFeatureTab\(searchParams\.get\("tab"\)\) \?\? "open_cards"/);
});
test('adjacent tab changes notify the Next router without reusing internal history markers', () => {
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(homeTree) === 'handleHomeFeatureTabChange') handler = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(homeTree);
  let selected, historyArgs;
  const fn = evaluate(`const {window, setHomeFeatureTab} = require('fixture'); module.exports = ${handler.getText(homeTree)};`, {
    fixture: { setHomeFeatureTab: value => { selected = value; }, window: {
      location: { href: 'https://fixture.invalid/community/dating/cards?source=home#anchor' },
      history: { state: { __NA: true }, replaceState(...args) { historyArgs = args; } },
    } },
  });
  fn('one_on_one');
  assert.equal(selected, 'one_on_one');
  assert.deepEqual(historyArgs, [null, '', '/community/dating/cards?source=home&tab=one_on_one#anchor']);
});
for (const state of [{ loading: true }, { error: '불러오지 못했습니다.' }]) test(`loading/error never invites duplicate registration: ${JSON.stringify(state)}`, () => {
  const markup = renderToStaticMarkup(React.createElement(Panel, { ...panelProps, ...state }));
  assert.ok(!markup.includes('href="/onboarding/dating"'));
});
test('home tabs follow URL changes; the intentional open-card to 1:1 promotion remains', () => {
  assert.match(home, /setHomeFeatureTab\(requestedTab \?\? "open_cards"\)/);
  assert.match(home, /\}, \[searchParams\]\)/);
  assert.match(home, /!showOneOnOneSection && !showLoveFortuneSection/);
  assert.match(home, /\(showOpenCardSection \|\| showOneOnOneSection\) &&\s*\(cardsAudience\?\.canSwitchSex === true \|\| cardsAudience\?\.targetSex\)/);
  assert.ok(home.includes('aria-label="매칭 종류 선택"'));
});
test('the entire adjacent card/1:1 tab row is preserved from the deployed version', () => {
  const baseline = execFileSync('git', ['show', `612fb1d:${homeFile}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  function tabRow(source) {
    const tree = ast(source); let result;
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.getText(tree).includes('aria-label="매칭 종류 선택"')) result = node.getText(tree).replace(/\r\n/g, '\n');
      ts.forEachChild(node, visit);
    }
    visit(tree); assert.ok(result); return result;
  }
  assert.equal(tabRow(home), tabRow(baseline));
});
test('card management remains accessible from every filter; existing operations stay intact', () => {
  assert.match(mypage, /setMatchingFilter\("all"\);\s*setOpenCardManagementOpen\(true\);\s*scrollToMyPageTarget\("matching", "my-open-card-status"\)/);
  assert.match(mypage, /open=\{openCardManagementOpen\}/);
  assert.match(mypage, /onToggle=\{\(event\) => setOpenCardManagementOpen\(event.currentTarget.open\)\}/);
  for (const operation of ['handleDeleteMyOpenCard(card.id)', 'handleReactivateMyOpenCard(card)', 'handleReopenMyOpenCard(card)', 'handleToggleMyOpenCardPhotoVisibility(']) assert.ok(mypage.includes(operation));
});
for (const file of [homeFile, mypageFile, 'components/Header.tsx', 'components/MobileBottomTabBar.tsx']) test(`all API calls unchanged from deployed baseline: ${file}`, () => {
  const baseline = execFileSync('git', ['show', `612fb1d:${file}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.deepEqual(fetchCalls(read(file)), fetchCalls(baseline));
  assert.equal(ast(read(file)).parseDiagnostics.length, 0);
});
