/* eslint-disable @typescript-eslint/no-require-imports */
// Local PostgreSQL and real route tests; no .env, member data or external calls.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sql = fs.readFileSync(path.join(root, 'supabase/sql/dating_candidate_hides.sql'), 'utf8');
function loader(overrides = {}) {
  const cache = new Map();
  return function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const m = { exports: {} }; cache.set(name, m);
    const js = ts.transpileModule(fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', js)(load, m, m.exports);
    return m.exports;
  };
}
async function fixture(run) {
  const db = new PGlite();
  const q = (s, args = []) => db.query(s, args);
  const hide = (user = id(1), source = id(11), candidate = id(12)) => q('select hide_dating_1on1_candidate($1,$2,$3) as result', [user, source, candidate]);
  const restore = (user, hideId) => q('select restore_dating_1on1_candidate($1,$2)', [user, hideId]);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table dating_1on1_cards(id uuid primary key,user_id uuid,name text,sex text,status text);
      create table dating_1on1_match_proposals(id uuid primary key,state text,contact_exchange_status text);
      create table toss_test_payment_orders(id uuid primary key,amount int,status text);
      create table dating_1on1_recommendation_refresh_events(id uuid primary key);
      create table dating_1on1_candidate_favorites(id uuid primary key);
      create table notifications(id uuid primary key);
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    await q('insert into auth.users values($1),($2),($3)', [id(1), id(2), id(3)]);
    await q("insert into dating_1on1_cards values($1,$2,'내 프로필','male','approved'),($3,$4,'상대 프로필','female','submitted'),($5,$6,'같은 성별','male','reviewing')", [id(11), id(1), id(12), id(2), id(13), id(3)]);
    await q("insert into dating_1on1_match_proposals values($1,'mutual_accepted','approved')", [id(21)]);
    await q("insert into toss_test_payment_orders values($1,18000,'paid')", [id(31)]);
    const untouched = async () => Promise.all(['dating_1on1_match_proposals','toss_test_payment_orders','dating_1on1_recommendation_refresh_events','dating_1on1_candidate_favorites','notifications'].map(t => q('select * from ' + t)));
    const before = await untouched();
    await db.exec(sql); await db.exec(sql);
    await run({ db, q, hide, restore });
    assert.deepEqual(await untouched(), before, 'no match/payment/quota/favorite/notification mutations');
  } finally { await db.close(); }
}

test('hide is idempotent, one-way and owned; restore is idempotent and cannot restore another user', () => fixture(async f => {
  const a = (await f.hide()).rows[0].result;
  assert.equal(a.ok, true); assert.equal((await f.hide()).rows[0].result.id, a.id);
  assert.equal((await f.q('select count(*)::int n from dating_1on1_candidate_hides')).rows[0].n, 1);
  await f.restore(id(3), a.id);
  assert.equal((await f.q('select count(*)::int n from dating_1on1_candidate_hides')).rows[0].n, 1);
  const reverse = (await f.hide(id(2), id(12), id(11))).rows[0].result;
  assert.notEqual(reverse.id, a.id);
  await f.restore(id(1), a.id); await f.restore(id(1), a.id);
  assert.equal((await f.q('select user_id from dating_1on1_candidate_hides')).rows[0].user_id, id(2));
}));
test('wrong ownership, self, same sex, archived source and null input fail without inserting', () => fixture(async f => {
  await assert.rejects(f.hide(id(3)), /HIDE_SOURCE/);
  await assert.rejects(f.hide(undefined, undefined, id(11)), /HIDE_CANDIDATE/);
  await assert.rejects(f.hide(undefined, undefined, id(13)), /HIDE_CANDIDATE/);
  await assert.rejects(f.hide(null), /HIDE_INPUT/);
  await f.q("update dating_1on1_cards set status='rejected' where id=$1", [id(11)]);
  await assert.rejects(f.hide(), /HIDE_SOURCE/);
  assert.equal((await f.q('select count(*)::int n from dating_1on1_candidate_hides')).rows[0].n, 0);
}));
test('hidden account remains hidden after deleting and recreating its card', () => fixture(async f => {
  const first = (await f.hide()).rows[0].result;
  await f.q('delete from dating_1on1_cards where id=$1', [id(12)]);
  assert.equal((await f.q('select candidate_card_id from dating_1on1_candidate_hides')).rows[0].candidate_card_id, null);
  await f.q("insert into dating_1on1_cards values($1,$2,'새 프로필','female','approved')", [id(22), id(2)]);
  assert.equal((await f.hide(id(1), id(11), id(22))).rows[0].result.id, first.id);
}));
test('private permissions survive broad Supabase default grants', () => fixture(async f => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await f.db.exec('set role ' + role);
    if (role !== 'service_role') {
      await assert.rejects(f.q('select * from dating_1on1_candidate_hides'), /permission denied/);
      await assert.rejects(f.hide(), /permission denied/);
      await assert.rejects(f.restore(id(1), id(90)), /permission denied/);
    } else {
      await f.hide(); await f.q('select * from dating_1on1_candidate_hides');
    }
    await assert.rejects(f.q('delete from dating_1on1_candidate_hides'), /permission denied/);
    await assert.rejects(f.q("update dating_1on1_candidate_hides set candidate_name='X'"), /permission denied/);
    await f.db.exec('reset role');
  }
  assert.equal((await f.q("select relrowsecurity from pg_class where oid='dating_1on1_candidate_hides'::regclass")).rows[0].relrowsecurity, true);
}));
test('500-entry limit is safe and idempotent retry still works at the limit', () => fixture(async f => {
  const first = (await f.hide()).rows[0].result;
  for (let n = 100; n < 599; n++) {
    await f.q('insert into auth.users values($1)', [id(n)]);
    await f.q("insert into dating_1on1_candidate_hides(user_id,candidate_user_id,candidate_name) values($1,$2,'숨긴 후보')", [id(1), id(n)]);
  }
  assert.equal((await f.hide()).rows[0].result.id, first.id);
  await f.q("update dating_1on1_cards set sex='female' where id=$1", [id(13)]);
  await assert.rejects(f.hide(id(1), id(11), id(13)), /HIDE_LIMIT/);
}));

function routeFixture({ signedIn = true, originError = false, ticketSource = id(11), favorite = [], proposal = [], rpcError = null, rows = [], readError = null } = {}) {
  const calls = [], queries = [];
  const admin = {
    from(table) {
      const filters = []; const q = { table, filters }; queries.push(q);
      const b = { select: () => b, order: () => b, limit: () => b, eq: (k,v) => { filters.push([k,v]); return b; },
        then: (ok, bad) => Promise.resolve(table === 'dating_1on1_candidate_hides' ? { data: rows, error: readError } : { data: table.includes('favorites') ? favorite : proposal, error: null }).then(ok, bad) };
      return b;
    },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true, id: id(91) }, error: rpcError }; },
  };
  const load = loader({
    '@/lib/supabase/server': { createAdminClient: () => admin },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: signedIn ? { id: id(1) } : null }) },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => originError ? new Response('blocked', { status: 403 }) : null },
    '@/lib/dating-1on1-impressions': { verifyImpressionTicket: () => ticketSource ? { source: ticketSource } : null },
  });
  const route = load('@/app/api/dating/1on1/candidate-hides/route');
  const post = (body = { action: 'hide', sourceCardId: id(11), candidateId: id(12) }) => route.POST(new Request('http://localhost/api/dating/1on1/candidate-hides', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { route, post, calls, queries };
}

test('page reconstruction excludes old hides but reserves later hidden slots; invalid dates fail closed', () => {
  const { candidateHideUserIdsAt } = loader()('@/lib/dating-candidate-hides');
  const at = Date.parse('2026-10-28T00:00:00+09:00');
  const rows = [-1, 0, 1].map((offset, i) => ({ candidate_user_id: id(i + 10), created_at: new Date(at + offset).toISOString() }));
  rows.push({ candidate_user_id: id(20), created_at: 'invalid' });
  assert.deepEqual([...candidateHideUserIdsAt(rows, at)], [id(10), id(11), id(20)]);
  assert.equal(candidateHideUserIdsAt(rows, NaN).size, 4);
  assert.equal(candidateHideUserIdsAt(rows, at + 2).size, 4, 'next generation applies every existing hide');
});
test('API authentication, CSRF, malformed/oversized body, wrong receipt and guessed IDs are rejected', async () => {
  assert.equal((await routeFixture({ signedIn: false }).post()).status, 401);
  assert.equal((await routeFixture({ originError: true }).post()).status, 403);
  for (const body of ['{', 'x'.repeat(6501), {}, { action: 'restore', id: 'bad' }, { action: 'hide', sourceCardId: id(11), candidateId: id(11) }]) {
    const f = routeFixture(); assert.equal((await f.post(body)).status, 400); assert.equal(f.calls.length, 0);
  }
  for (const ticketSource of [null, id(13)]) {
    const f = routeFixture({ ticketSource }); assert.equal((await f.post()).status, 409); assert.equal(f.calls.length, 0);
    assert.ok(f.queries.every(q => q.filters.some(([k,v]) => ['user_id','source_user_id'].includes(k) && v === id(1))));
  }
});
test('API uses authenticated owner, allows owned favorites/proposals and never returns contacts', async () => {
  for (const options of [{}, { ticketSource: null, favorite: [{ candidate_card_id: id(12) }] }, { ticketSource: null, proposal: [{ id: id(21) }] }]) {
    const f = routeFixture(options); const result = await f.post({ action: 'hide', sourceCardId: id(11), candidateId: id(12), userId: id(3) });
    assert.equal(result.status, 200); assert.equal(f.calls[0].args.p_user, id(1));
    assert.equal(f.calls[0].name, 'hide_dating_1on1_candidate');
  }
  const f = routeFixture({ rows: [{ id: id(91), candidate_user_id: id(2), candidate_card_id: id(12), candidate_name: '가나다', created_at: new Date().toISOString(), phone: 'never-expose' }] });
  const result = await f.route.GET(new Request('http://localhost'));
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  const body = await result.json(); assert.deepEqual(Object.keys(body.items[0]), ['id','name','created_at']);
  assert.equal((await f.post({ action: 'restore', id: id(91), userId: id(3) })).status, 200);
  assert.deepEqual(f.calls[0], { name: 'restore_dating_1on1_candidate', args: { p_user: id(1), p_hide: id(91) } });
});
test('missing schema is disabled; DB failure fails closed; RPC failure never reports success', async () => {
  for (const code of ['42P01','PGRST205','57014']) {
    const f = routeFixture({ readError: { code } }); const result = await f.route.GET(new Request('http://localhost'));
    assert.equal(result.status, code === '57014' ? 503 : 200);
    if (result.ok) assert.deepEqual(await result.json(), { enabled: false, items: [] });
  }
  const overflow = routeFixture({ rows: Array(501).fill({}) });
  assert.equal((await overflow.route.GET(new Request('http://localhost'))).status, 503);
  for (const error of [{ code: 'PGRST202' }, { code: '57014' }, { message: 'HIDE_LIMIT' }, { message: 'HIDE_SOURCE' }]) {
    const response = await routeFixture({ rpcError: error }).post(); assert.ok(response.status >= 400); assert.equal((await response.json()).ok, undefined);
  }
});
