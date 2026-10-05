/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, imports, extra = '') {
  const out = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8') + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', out)(imports, mod, mod.exports);
  return mod.exports;
}
const regions = load('lib/region-city.ts', require);
const coords = load('lib/korea-admin-division-coords.ts', require);
const distance = load('lib/region-distance.ts', id => id.endsWith('region-city') ? regions : coords);
const candidates = load('lib/dating-city-view-candidates.ts', id => id.endsWith('region-city') ? regions : distance);
const policy = load('lib/dating-city-view-policy.ts', require);
const city = load('lib/dating-city-view.ts', id => id.endsWith('region-city') ? regions : policy);
function row(id, region, extra = {}) {
  return { id, owner_user_id: id, region, sex: 'female', status: 'pending', created_at: '2026-01-01', ...extra };
}
function historyDb(seen, error = null) {
  return { from() {
    const q = { then(resolve, reject) { return Promise.resolve({ data: [{ snapshot_card_ids: seen, snapshot_seen_card_ids: seen }], error }).then(resolve, reject); } };
    for (const key of ['select', 'eq', 'order', 'limit']) q[key] = () => q;
    return q;
  } };
}
function builder(rows, { blocks = [], contacts = [] } = {}) {
  return load('lib/dating-purchase-fulfillment.ts', id => {
    if (id.endsWith('dating-city-view-candidates')) return { ...candidates, fetchCityViewCandidateRows: async () => rows };
    if (id.endsWith('dating-city-view')) return { ...city, getCityViewTargetSex: async () => 'female' };
    if (id.endsWith('dating-city-view-policy')) return policy;
    if (id.endsWith('region-city')) return regions;
    if (id.endsWith('dating-blocks')) return { getDatingBlockedUserIds: async () => new Set(blocks) };
    if (id.endsWith('dating-contact-blocks')) return { filterDatingCardsByContactBlocks: async (_, __, values) => values.filter(r => !contacts.includes(r.owner_user_id)) };
    return {};
  }, '\nexport { buildCityViewSnapshotCardIds };');
}
for (const province of ['강원', '강원도', '강원특별자치도']) {
  test(`${province}: previously seen local candidates precede 40 unseen Gyeonggi candidates`, async () => {
    const locals = Array.from({ length: 10 }, (_, i) => row(`local-${i}`, i % 2 ? '강릉' : '강원도 원주시'));
    const outsiders = Array.from({ length: 40 }, (_, i) => row(`outside-${i}`, '경기도 하남시'));
    const result = await builder([...outsiders, ...locals]).buildCityViewSnapshotCardIds(historyDb(locals.map(r => r.id)), 'viewer', province, 'female');
    assert.equal(result.length, 30);
    assert.deepEqual(new Set(result.slice(0, 10)), new Set(locals.map(r => r.id)));
    assert.equal(new Set(result).size, result.length);
  });
}
test('fresh local comes first, then seen local, then unseen other provinces', async () => {
  const rows = [row('seen-local', '강원'), row('new-outside', '경기 남양주'), row('new-local', '강릉')];
  assert.deepEqual(await builder(rows).buildCityViewSnapshotCardIds(historyDb(['seen-local']), 'viewer', '강원', 'female'),
    ['new-local', 'seen-local', 'new-outside']);
});
test('underfilled regions keep nearby fallback instead of dropping all nonlocal cards', async () => {
  const rows = [row('far', '제주'), row('near', '경기 남양주'), row('local', '강원 원주')];
  assert.deepEqual(await builder(rows).buildCityViewSnapshotCardIds(historyDb([]), 'viewer', '강원', 'female'), ['local', 'near', 'far']);
});
test('no local candidates still yields nearby results', async () => {
  const rows = [row('far', '부산'), row('near', '경기 남양주')];
  assert.deepEqual(await builder(rows).buildCityViewSnapshotCardIds(historyDb([]), 'viewer', '강원', 'female'), ['near', 'far']);
});
test('more than 30 local candidates never includes nonlocal cards', async () => {
  const locals = Array.from({ length: 35 }, (_, i) => row(`local-${i}`, '강원'));
  const rows = [...locals, row('outside', '경기')];
  const result = await builder(rows).buildCityViewSnapshotCardIds(historyDb(locals.map(r => r.id)), 'viewer', '강원', 'female');
  assert.equal(result.length, 30);
  assert.ok(result.every(id => id.startsWith('local-')));
});
test('self, user/contact blocks, wrong sex, hidden, expired and unknown regions remain excluded', async () => {
  const rows = [row('ok', '강원'), row('self', '강원', { owner_user_id: 'viewer' }), row('blocked', '강원'), row('contact', '강원'),
    row('male', '강원', { sex: 'male' }), row('hidden', '강원', { status: 'hidden' }), row('expired', '강원', { status: 'public', expires_at: '2020-01-01' }), row('unknown', '우주')];
  assert.deepEqual(await builder(rows, { blocks: ['blocked'], contacts: ['contact'] }).buildCityViewSnapshotCardIds(historyDb([]), 'viewer', '강원', 'female'), ['ok']);
});
test('new candidate offer counts the actual region-first paid allocation', async () => {
  const locals = Array.from({ length: 10 }, (_, i) => row(`local-${i}`, '강원'));
  const outside = Array.from({ length: 40 }, (_, i) => row(`outside-${i}`, '경기'));
  const result = await builder([...locals, ...outside]).getCityViewPurchasePreview(historyDb(locals.map(r => r.id)), 'viewer', '강원', 'female');
  assert.equal(result.newCount, 20);
});
test('paid/weekly limits are unchanged and weekly access keeps its fixed snapshot', () => {
  assert.equal(city.CITY_VIEW_CARD_LIMIT, 30);
  assert.equal(policy.WEEKLY_CITY_VIEW_LIMIT, 10);
  const source = fs.readFileSync(path.join(root, 'app/api/dating/cards/city-view/list/route.ts'), 'utf8');
  assert.match(source, /activeGrant\.snapshotCardIds\.slice\(0, WEEKLY_CITY_VIEW_LIMIT\)/);
});
test('existing paid snapshot repair still moves local candidates ahead without shrinking accumulated slots', () => {
  const rows = [row('local', '강원'), ...Array.from({ length: 34 }, (_, i) => row(`other-${i}`, '경기'))];
  const ids = candidates.buildRegionFirstCityViewCardIds(rows, '강원', rows.slice(1).map(r => r.id), 35);
  assert.equal(ids[0], 'local');
  assert.equal(ids.length, 35);
});
for (const failedStatus of ['pending', 'public']) {
  test(`${failedStatus} pool error fails closed instead of persisting an incomplete region snapshot`, async () => {
    const db = { from() {
      let status;
      const q = { then(resolve, reject) { return Promise.resolve(status === failedStatus ? { data: null, error: { code: '57014' } } : { data: [row('other', '경기')], error: null }).then(resolve, reject); } };
      for (const key of ['select', 'order', 'range', 'gt']) q[key] = () => q;
      q.eq = (_, value) => { status = value; return q; };
      return q;
    } };
    await assert.rejects(candidates.fetchCityViewCandidateRows(db), e => e.code === '57014');
  });
}
test('history failure does not silently treat every candidate as new', async () => {
  await assert.rejects(builder([row('ok', '강원')]).buildCityViewSnapshotCardIds(historyDb([], { code: '57014' }), 'viewer', '강원', 'female'));
});
function poolDb(rows, profiles, profileError = null) {
  let profileReads = 0;
  return { get profileReads() { return profileReads; }, from(table) {
    let status, ids;
    const q = { then(resolve, reject) {
      if (table === 'profiles') profileReads++;
      return Promise.resolve(table === 'profiles'
        ? { data: profiles.filter(p => ids.includes(p.user_id)), error: profileError }
        : { data: rows.filter(r => r.status === status), error: null }).then(resolve, reject);
    } };
    for (const key of ['select', 'order', 'range', 'gt']) q[key] = () => q;
    q.eq = (_, value) => { status = value; return q; };
    q.in = (_, value) => { ids = value; assert.ok(ids.length <= 200); return q; };
    return q;
  } };
}
test('legacy orphan cards and banned owners do not consume a local slot', async () => {
  const rows = [row('ok', '강원'), row('orphan', '강원'), row('banned', '강원'), row('no-owner', '강원', { owner_user_id: null })];
  const db = poolDb(rows, [{ user_id: 'ok', is_banned: false }, { user_id: 'banned', is_banned: true }]);
  assert.deepEqual((await candidates.fetchCityViewCandidateRows(db)).map(r => r.id), ['ok']);
});
test('owner lookup failure cannot be treated as a usable partial candidate pool', async () => {
  await assert.rejects(candidates.fetchCityViewCandidateRows(poolDb([row('ok', '강원')], [], { code: '57014' })), e => e.code === '57014');
});
test('owner queries are batched and an empty pool has no profile reads', async () => {
  const rows = Array.from({ length: 201 }, (_, i) => row(`owner-${i}`, '강원'));
  const db = poolDb(rows, rows.map(r => ({ user_id: r.owner_user_id, is_banned: null })));
  assert.equal((await candidates.fetchCityViewCandidateRows(db)).length, 201);
  assert.equal(db.profileReads, 2);
  const empty = poolDb([], []);
  assert.deepEqual(await candidates.fetchCityViewCandidateRows(empty), []);
  assert.equal(empty.profileReads, 0);
});
