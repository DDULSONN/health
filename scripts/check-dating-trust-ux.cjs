/* eslint-disable @typescript-eslint/no-require-imports */
// Offline regressions: no accounts, payments, storage or provider connections.
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file) {
  const m = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(m, m.exports);
  return m.exports;
}
const blocks = load('lib/dating-blocks.ts'), visibility = load('lib/dating-report-visibility.ts');
function db(error, data = []) {
  const q = { select: () => q, or: () => q, limit: () => q, maybeSingle: () => q, then: (yes, no) => Promise.resolve({ error, data }).then(yes, no) };
  return { from: table => { assert.equal(table, 'dating_user_blocks'); return q; } };
}
for (const error of [
  { code: '42501', message: 'permission denied for table dating_user_blocks' },
  { code: '57014', message: 'dating_user_blocks statement timeout' },
  { code: '42703', message: 'column dating_user_blocks.reason does not exist' },
  { message: 'dating_user_blocks network unavailable' },
]) test('block lookup fails closed: ' + error.message, async () => {
  assert.equal(blocks.isMissingDatingBlocksTableError(error), false);
  await assert.rejects(blocks.getDatingBlockedUserIds(db(error), 'self'), e => e === error);
  await assert.rejects(blocks.hasDatingBlockBetween(db(error), 'self', 'other'), e => e === error);
});
test('only a genuinely missing legacy relation keeps its compatibility fallback', async () => {
  for (const error of [{ code: '42P01' }, { code: 'PGRST205' }, { message: 'relation "dating_user_blocks" does not exist' }]) {
    assert.equal(blocks.isMissingDatingBlocksTableError(error), true);
    assert.equal((await blocks.getDatingBlockedUserIds(db(error), 'self')).size, 0);
  }
});
test('successful block reads include both directions', async () => {
  const result = await blocks.getDatingBlockedUserIds(db(null, [
    { blocker_user_id: 'self', blocked_user_id: 'a' }, { blocker_user_id: 'b', blocked_user_id: 'self' },
  ]), 'self');
  assert.deepEqual([...result], ['a', 'b']);
  assert.equal(await blocks.hasDatingBlockBetween(db(null, { id: 'block' }), 'self', 'other'), true);
});
test('confirmed report removes only the target from normal, additional and match lists without mutation', () => {
  const keep = { id: 'keep', user_id: 'safe' }, bad = { id: 'bad-card', user_id: 'bad' };
  const groups = [{ source_card_id: 'own', refresh_remaining: 2, recommendations: [bad, keep], admin_recommendations: [keep, { ...bad, id: 'other-card' }], favorite_candidates: [bad, keep] }];
  const matches = [{ id: 'bad-match', counterparty_card: bad }, { id: 'safe-match', counterparty_card: keep }];
  const before = JSON.stringify({ groups, matches }), report = { blocked: true, blockedUserId: 'bad' };
  const result = visibility.hideReportedRecommendations(groups, report);
  assert.deepEqual(result[0].recommendations, [keep]); assert.deepEqual(result[0].admin_recommendations, [keep]);
  assert.deepEqual(result[0].favorite_candidates, [keep]);
  assert.equal(result[0].refresh_remaining, 2);
  assert.deepEqual(visibility.hideReportedMatches(matches, report), [matches[1]]);
  assert.equal(JSON.stringify({ groups, matches }), before);
});
test('redacted user IDs still remove the server-resolved card across surfaces', () => {
  const groups = [{ recommendations: [{ id: 'bad-card' }, { id: 'keep' }] }];
  const report = { blocked: true, targetType: 'one_on_one_match', targetId: 'match', blockedCardId: 'bad-card' };
  assert.deepEqual(visibility.hideReportedRecommendations(groups, report)[0].recommendations, [{ id: 'keep' }]);
  assert.deepEqual(visibility.hideReportedMatches([{ id: 'match' }, { id: 'other', counterparty_card: { id: 'bad-card' } }], report), []);
});
test('failed blocks never falsely hide a person; missing legacy IDs only hide the known target', () => {
  const groups = [{ recommendations: [{ id: 'bad' }, { id: 'safe' }] }], matches = [{ id: 'match' }];
  assert.equal(visibility.hideReportedRecommendations(groups, { blocked: false, blockedUserId: 'bad' }), groups);
  assert.equal(visibility.hideReportedMatches(matches, { blocked: false, targetType: 'one_on_one_match', targetId: 'match' }), matches);
  assert.deepEqual(visibility.hideReportedRecommendations(groups, { blocked: true, targetType: 'one_on_one_card', targetId: 'bad' })[0].recommendations, [{ id: 'safe' }]);
  assert.deepEqual(visibility.hideReportedRecommendations(groups, { blocked: true, targetType: 'open_card', blockedCardId: 'bad' }), groups);
});
test('both consumers cancel stale reads before immediate removal and still refresh from the server', () => {
  for (const file of ['app/community/dating/cards/page.tsx', 'app/mypage/page.tsx']) {
    const source = read(file), start = source.indexOf(file.includes('mypage') ? 'const onDatingReportSubmitted' : 'onReported={(result) => {');
    const handler = source.slice(start, start + 1800);
    assert.ok(start >= 0); assert.ok(handler.indexOf('Request.cancel()') < handler.indexOf('hideReportedMatches('));
    assert.match(handler, /hideReportedRecommendations/); assert.match(handler, /reloadOneOnOne/);
  }
});
test('open-card edit shares bounded uploads and never retries profile/payment writes automatically', () => {
  const source = read('app/community/dating/cards/new/page.tsx');
  for (const stage of ['open_raw', 'open_lite', 'open_blur']) assert.ok(source.includes('"' + stage + '"'));
  assert.equal((source.match(/await uploadDatingPhoto\(/g) || []).length, 3);
  assert.ok(source.indexOf('"open_blur"') < source.indexOf('method: isEditMode ? "PATCH"'));
  assert.match(source, /const nextRawPaths = \[\.\.\.existingRawPaths\]/);
  assert.match(source, /if \(!photo\) continue/);
  assert.match(source, /error instanceof DatingPhotoUploadError \? error.message/);
});
