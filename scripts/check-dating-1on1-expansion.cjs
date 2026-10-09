/* eslint-disable @typescript-eslint/no-require-imports */
// Local real-module/SQL tests only. No member data or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loader(overrides = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const mod = { exports: {} }; cache.set(name, mod);
    const js = ts.transpileModule(fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', js)(load, mod, mod.exports);
    return mod.exports;
  }
  return load;
}
const rules = loader()('@/lib/dating-1on1-expansion');
const now = Date.parse('2026-10-09T03:00:00Z'), day = '2026-10-09';
const card = (id, rest = {}) => ({ id, user_id: 'u-' + id, sex: 'female', age: 28,
  region: '서울 강남구', created_at: new Date(now - 86400000).toISOString(), ...rest });
const source = card('source', { sex: 'male', age: 30 });

test('rollout is server controlled, off by default, stable and bounded', () => {
  for (const value of ['', '0', '-1', '101', '20.5', ' 20', 'NaN']) assert.equal(rules.isExpansionEnabled('member', value), false);
  assert.equal(rules.isExpansionEnabled('', '100'), false);
  let enabled = 0;
  for (let i = 0; i < 1000; i++) {
    assert.equal(rules.isExpansionEnabled('u' + i, '100'), true);
    const a = rules.isExpansionEnabled('u' + i, '20');
    assert.equal(a, rules.isExpansionEnabled('u' + i, '20')); enabled += Number(a);
  }
  assert.ok(enabled > 150 && enabled < 250);
});
test('expansion keeps age, region, activity and exclusions; caps at three', () => {
  const eligible = Array.from({ length: 15 }, (_, i) => card('c' + i));
  const bad = [source, card('male', { sex: 'male' }), card('age', { age: 45 }),
    card('far', { region: '부산 해운대구' }), card('unknown', { region: '알수없음' }),
    card('inactive', { created_at: '2025-01-01' }), card('future', { created_at: '2099-01-01' }),
    card('handled', { last_handled_at: new Date(now - 1000).toISOString() })];
  const pick = () => rules.selectExpansionCandidates(source, [...bad, ...eligible], new Set(['c0']), day, now);
  assert.equal(pick().length, 3); assert.deepEqual(pick(), pick());
  assert.ok(pick().every(c => c.id.startsWith('c') && c.id !== 'c0'));
  assert.equal(rules.selectExpansionCandidates(source, bad, new Set(), day, now).length, 0);
});
test('stored batches preserve order, drop ineligible people and never refill', () => {
  const pool = Array.from({ length: 15 }, (_, i) => card('c' + i));
  const pick = snapshot => rules.selectExpansionCandidates(source, pool, new Set(['c1']), day, now, snapshot).map(c => c.id);
  assert.deepEqual(pick(['c2', 'c1', 'missing']), ['c2']);
  assert.deepEqual(pick([]), []); assert.deepEqual(pick(['c2', 'c2', 'c3']), ['c2', 'c3']);
});
test('local candidates are preferred before adjacent regions', () => {
  const pool = [card('adjacent', { region: '강원 춘천' }), card('near')];
  assert.deepEqual(rules.selectExpansionCandidates(source, pool, new Set(), day, now).map(c => c.id), ['near', 'adjacent']);
});

const sourceId = '00000000-0000-4000-8000-000000000001';
const ownerId = '00000000-0000-4000-8000-000000000002';
const candidateId = '00000000-0000-4000-8000-000000000003';
const otherId = '00000000-0000-4000-8000-000000000004';
async function routeFixture(options = {}) {
  const calls = [], plans = [];
  const batch = { source_card_id: sourceId, day_key: day, candidate_ids: [candidateId] };
  const db = {
    from(name) { assert.equal(name, rules.EXPANSION_TABLE); calls.push(['read']);
      const q = { select() { return q; }, eq(key, value) { calls.push([key, value]); return q; },
        maybeSingle: async () => ({ data: options.saved ?? null, error: options.readError ?? null }) }; return q;
    },
    async rpc(name, args) { calls.push(['rpc', name, args]);
      return options.rpcResult ?? { data: [{ ...batch, candidate_ids: args.p_candidate_ids }], error: null };
    },
  };
  let dayReads = 0;
  const load = loader({
    '@/lib/supabase/server': { createAdminClient: () => db },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: options.anon ? null : { id: ownerId } }) },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => options.badOrigin ? Response.json({}, { status: 403 }) : null },
    '@/lib/weekly': { getKstDateString: () => options.midnight && dayReads++ ? '2026-10-10' : day },
    '@/lib/dating-1on1-expansion': { ...rules, isExpansionEnabled: () => !options.disabled },
    '@/lib/dating-1on1-recommendation-service': { loadOneOnOneRecommendations: async (_db, user, refresh, expansion) => {
      assert.equal(user.id, ownerId); assert.equal(refresh, undefined); plans.push(expansion);
      return Response.json(options.serviceBody ?? { source_card_id: sourceId,
        candidates: (expansion.candidateIds ?? [candidateId]).map(id => ({ id, name: '한글 후보' })) }, { status: options.serviceStatus ?? 200 });
    } },
  });
  const response = await load('@/app/api/dating/1on1/recommendations/expand/route').POST(new Request('http://localhost/api/dating/1on1/recommendations/expand', {
    method: 'POST', body: options.invalidJson ? '{' : JSON.stringify({ source_card_id: options.sourceId ?? sourceId, candidate_ids: [otherId], day_key: '2099-01-01', refresh_seed: 'forged' }),
  }));
  return { response, body: await response.json(), calls, plans };
}
for (const [label, options, status] of [
  ['authentication', { anon: true }, 401], ['origin', { badOrigin: true }, 403], ['rollout', { disabled: true }, 404],
  ['malformed source', { sourceId: 'wrong' }, 400], ['malformed JSON', { invalidJson: true }, 400],
  ['missing SQL', { readError: { code: 'PGRST205' } }, 503], ['service failure', { serviceStatus: 503 }, 503],
  ['wrong profile', { serviceBody: { source_card_id: otherId, candidates: [] } }, 409],
  ['RPC failure', { rpcResult: { error: { code: 'XX000' }, data: null } }, 503],
  ['midnight', { midnight: true }, 409],
  ['ineligible source', { serviceStatus: 403 }, 403],
  ['malformed saved batch', { saved: { source_card_id: sourceId, day_key: day, candidate_ids: null } }, 503],
  ['duplicate server IDs', { serviceBody: { source_card_id: sourceId, candidates: [{ id: candidateId }, { id: candidateId }] } }, 503],
  ['invalid server IDs', { serviceBody: { source_card_id: sourceId, candidates: [null] } }, 503],
]) test('expansion route fails safely: ' + label, async () => {
  const r = await routeFixture(options); assert.equal(r.response.status, status);
  assert.equal(r.body.candidates, undefined); assert.ok(r.calls.filter(c => c[0] === 'rpc').length <= 1);
});
test('route persists only server-selected IDs and KST day; no refresh/payment RPC', async () => {
  const r = await routeFixture(); assert.equal(r.response.status, 200);
  assert.equal(r.response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(r.calls.filter(c => c[0] === 'rpc'), [['rpc', 'claim_dating_1on1_expansion_batch', {
    p_user_id: ownerId, p_source_card_id: sourceId, p_day_key: day, p_candidate_ids: [candidateId],
  }]]);
  assert.equal(r.body.expires_at, '2026-10-09T15:00:00.000Z');
  assert.equal(r.body.candidates[0].name, '한글 후보');
});
test('repeat, empty and concurrent-winner batches are revalidated without replacing', async () => {
  for (const candidate_ids of [[], [candidateId]]) {
    const r = await routeFixture({ saved: { source_card_id: sourceId, day_key: day, candidate_ids } });
    assert.deepEqual(r.plans, [{ candidateIds: candidate_ids }]); assert.equal(r.calls.some(c => c[0] === 'rpc'), false);
  }
  const r = await routeFixture({ rpcResult: { data: [{ source_card_id: sourceId, day_key: day, candidate_ids: [otherId] }], error: null } });
  assert.deepEqual(r.plans, [{ candidateIds: undefined }, { candidateIds: [otherId] }]);
  assert.deepEqual(r.body.candidates.map(c => c.id), [otherId]);
  const stale = await routeFixture({ saved: { source_card_id: otherId, day_key: day, candidate_ids: [] } });
  assert.equal(stale.response.status, 409); assert.equal(stale.plans.length, 0);
});
test('a persisted batch cannot reveal IDs that were not claimed', async () => {
  const r = await routeFixture({ saved: { source_card_id: sourceId, day_key: day, candidate_ids: [candidateId] },
    serviceBody: { source_card_id: sourceId, candidates: [{ id: otherId }] } });
  assert.equal(r.response.status, 503); assert.equal(r.body.candidates, undefined);
});

test('real SQL: repeatable, one immutable daily batch, empty/concurrent claims, ACLs and account cleanup', async () => {
  const { PGlite } = require(process.env.REFRESH_TEST_PGLITE_PATH || '@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table dating_1on1_cards(id uuid primary key,user_id uuid,status text);
      insert into auth.users values('${ownerId}');
      insert into dating_1on1_cards values('${sourceId}','${ownerId}','approved');
      grant select on dating_1on1_cards to service_role;`);
    const sql = fs.readFileSync(path.join(root, 'supabase/sql/dating_1on1_expansion_batches.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const today = (await db.query("select to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD') d")).rows[0].d;
    const claim = async (ids = [candidateId], src = sourceId, date = today, user = ownerId) => (await db.query(
      'select * from claim_dating_1on1_expansion_batch($1,$2,$3,$4)', [user, src, date, ids])).rows;
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(claim(), /permission denied/);
      await assert.rejects(db.query('select * from dating_1on1_expansion_batches'), /permission denied/);
      await assert.rejects(db.query('delete from dating_1on1_expansion_batches'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const results = await Promise.all([claim([candidateId]), claim([otherId])]);
    assert.deepEqual(results[0][0].candidate_ids, results[1][0].candidate_ids);
    assert.equal((await db.query('select count(*) n from dating_1on1_expansion_batches')).rows[0].n, 1);
    await assert.rejects(db.query('update dating_1on1_expansion_batches set candidate_ids=$1', [[otherId]]), /permission denied/);
    await db.exec('delete from dating_1on1_expansion_batches');
    await claim([]); assert.deepEqual((await claim())[0].candidate_ids, []);
    await db.exec('delete from dating_1on1_expansion_batches');
    for (const args of [[null], [[null]], [[candidateId, candidateId]], [[sourceId]],
      [[candidateId, otherId, ownerId, sourceId]], [[candidateId], otherId], [[candidateId], sourceId, '2099-01-01'],
      [[candidateId], sourceId, today, otherId]]) await assert.rejects(claim(...args));
    assert.equal((await db.query('select count(*) n from dating_1on1_expansion_batches')).rows[0].n, 0);
    await claim(); await db.exec('reset role');
    await db.exec(`delete from auth.users where id='${ownerId}'`);
    assert.equal((await db.query('select count(*) n from dating_1on1_expansion_batches')).rows[0].n, 0);
  } finally { await db.close(); }
});
