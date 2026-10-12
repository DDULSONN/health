/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require(process.env.REFRESH_TEST_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
function loader(overrides = {}) {
  const cache = new Map();
  const load = name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith('@/')) return require(name);
    if (cache.has(name)) return cache.get(name).exports;
    const mod = { exports: {} }; cache.set(name, mod);
    const output = ts.transpileModule(fs.readFileSync(path.join(root, name.slice(2) + '.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', output)(load, mod, mod.exports);
    return mod.exports;
  };
  return load;
}
const uid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const viewer = uid(1), source = uid(2), candidate = uid(3), other = uid(4);
const helper = loader()('@/lib/dating-1on1-impressions');

test('client batches duplicates and serializes concurrent flushes without dropping pending views', async () => {
  const events = [], timers = new Map(), requests = [], mod = { exports: {} }; let timerId = 0;
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/dating-1on1-impressions-client.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const fetch = (_url, options) => new Promise(resolve => requests.push({ body: JSON.parse(options.body), resolve }));
  new Function('exports','module','fetch','setTimeout','clearTimeout','window','document',output)(mod.exports,mod,fetch,
    fn => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id),
    { addEventListener: name => events.push(name) }, { addEventListener: name => events.push(name) });
  const client = mod.exports;
  client.queueCandidateImpression('receipt','a'); client.queueCandidateImpression('receipt','a'); client.queueCandidateImpression('receipt','b');
  const first = client.flushCandidateImpressions();
  assert.deepEqual(requests[0].body.candidate_ids, ['a','b']);
  client.queueCandidateImpression('receipt','c');
  const second = client.flushCandidateImpressions(), third = client.flushCandidateImpressions();
  assert.equal(requests.length, 1);
  requests[0].resolve({ ok: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2); assert.deepEqual(requests[1].body.candidate_ids, ['c']);
  requests[1].resolve({ ok: true }); await Promise.all([first,second,third]);
  assert.equal(requests.length, 2); assert.deepEqual(events.sort(), ['pagehide','visibilitychange']); assert.equal(timers.size, 0);
});

test('signed impression receipt rejects forged, cross-account, expired and unsent cards', () => {
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-only-not-a-real-key';
  try {
    const at = Date.now();
    const ticket = helper.createImpressionTicket(viewer, source, [candidate, other], at);
    assert.ok(ticket); assert.equal(helper.verifyImpressionTicket(ticket, viewer, [candidate], at).source, source);
    for (const [token, user, cards, now] of [
      [ticket + 'a', viewer, [candidate], at], [ticket, other, [candidate], at], [ticket, viewer, [source], at],
      [ticket, viewer, [candidate], at + 86400000], [ticket, viewer, [candidate], at-1],
      [ticket, viewer, [], at], [ticket, viewer, [candidate, candidate], at], [ticket, viewer, ['bad'], at],
      [null, viewer, [candidate], at], ['x'.repeat(5001), viewer, [candidate], at],
    ]) assert.equal(helper.verifyImpressionTicket(token, user, cards, now), null);
    assert.equal(helper.createImpressionTicket('invalid', source, [candidate]), null);
    assert.equal(helper.createImpressionTicket(viewer, source, []), null);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(helper.createImpressionTicket(viewer, source, [candidate]), null);
  } finally { if (original == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = original; }
});

function readDb(count, error) {
  const calls = [], rows = Array.from({ length: count }, (_, i) => ({ candidate_user_id: uid(i+10), first_seen_at: new Date().toISOString() }));
  return { calls, from(table) {
    assert.equal(table, helper.IMPRESSION_TABLE);
    const q = { filters: [] };
    const b = { select: () => b, eq: (k,v) => { q.filters.push([k,v]); return b; }, gte: () => b, lte: () => b,
      order: () => b, range: (from,to) => { calls.push({ ...q, from, to }); return Promise.resolve({ data: rows.slice(from,to+1), error }); } };
    return b;
  } };
}
test('history reader is viewer scoped, paginated, bounded and migration safe', async () => {
  const db = readDb(1301);
  const result = await helper.readCandidateImpressions(db, viewer);
  assert.equal(result.rows.length, 1301); assert.equal(result.available, true); assert.equal(db.calls.length, 3);
  assert.ok(db.calls.every(c => c.filters.some(([k,v]) => k === 'viewer_user_id' && v === viewer)));
  assert.deepEqual(await helper.readCandidateImpressions(readDb(0, { code: '42P01' }), viewer), { available: false, rows: [] });
  await assert.rejects(helper.readCandidateImpressions(readDb(0, { code: 'XX000' }), viewer));
  await assert.rejects(helper.readCandidateImpressions(readDb(5000), viewer), /safe read bound/);
});

test('acknowledgement API authenticates and validates before any write; database failures remain optional', async () => {
  let user = { id: viewer }, denied = false, rpcError = false, writes = 0;
  const calls = [];
  const load = loader({
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user }) },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => denied ? new Response('', { status: 403 }) : null },
    '@/lib/supabase/server': { createAdminClient: () => ({ rpc: async (name,args) => {
      writes++; calls.push({name,args}); return { error: rpcError ? { code: 'PGRST202' } : null };
    } }) },
  });
  const original = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'local-test-only-not-a-real-key';
  try {
    const POST = load('@/app/api/dating/1on1/recommendations/impressions/route').POST;
    const ticket = helper.createImpressionTicket(viewer, source, [candidate]);
    const payload = { ticket, candidate_ids: [candidate] };
    const post = body => POST(new Request('http://localhost/api/dating/1on1/recommendations/impressions', {
      method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    }));
    denied = true; assert.equal((await post(payload)).status, 403); denied = false;
    user = null; assert.equal((await post(payload)).status, 401); user = { id: viewer };
    for (const invalid of [null, [], '{}', 'broken', 'x'.repeat(10001), { ticket, candidate_ids: [other] }]) {
      assert.equal((await post(invalid)).status, 400);
    }
    assert.equal(writes, 0);
    const res = await post(payload); assert.equal(res.status, 200); assert.deepEqual(await res.json(), { recorded: true });
    assert.match(res.headers.get('Cache-Control'), /no-store/);
    assert.deepEqual(calls[0], { name: 'record_dating_1on1_candidate_impressions', args: {
      p_user_id: viewer, p_source_card_id: source, p_candidate_card_ids: [candidate],
    } });
    rpcError = true;
    const failed = await post(payload); assert.equal(failed.status, 202); assert.deepEqual(await failed.json(), { recorded: false });
    assert.equal(writes, 2);
  } finally { if (original == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = original; }
});

test('real PostgreSQL: impression writes are idempotent, role restricted, private, account-scoped and additive', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table profiles(user_id uuid primary key,is_banned boolean);
      create table dating_1on1_cards(id uuid primary key,user_id uuid,sex text,status text);
      insert into auth.users values('${viewer}'),('${other}'),('${uid(5)}'),('${uid(6)}'),('${uid(7)}');
      insert into profiles values('${viewer}',false),('${other}',false),('${uid(5)}',true),('${uid(6)}',false),('${uid(7)}',false);
      insert into dating_1on1_cards values('${source}','${viewer}','male','approved'),('${candidate}','${other}','female','approved'),
        ('${uid(11)}','${other}','female','approved'),('${uid(12)}','${uid(5)}','female','approved'),
        ('${uid(13)}','${uid(6)}','male','approved'),('${uid(14)}','${uid(7)}','female','hidden');`);
    const sql = fs.readFileSync(path.join(root, 'supabase/sql/dating_1on1_candidate_impressions.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const query = async (q,args=[]) => (await db.query(q,args)).rows;
    const rows = () => query('select * from dating_1on1_candidate_impressions order by candidate_user_id');
    const call = (user=viewer, card=source, ids=[candidate]) => db.query('select record_dating_1on1_candidate_impressions($1,$2,$3)', [user,card,ids]);
    const cardsBefore = await query('select * from dating_1on1_cards order by id');
    for (const role of ['anon','authenticated']) {
      await db.exec('set role '+role); await assert.rejects(call(), /permission denied/);
      await assert.rejects(rows(), /permission denied/);
      await assert.rejects(db.exec(`insert into dating_1on1_candidate_impressions values('${viewer}','${other}',current_date,now())`), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await call(viewer,source,[candidate,uid(11),uid(12),uid(13),uid(14),source]);
    await db.exec('reset role');
    const first = await rows(); assert.equal(first.length, 1); assert.equal(first[0].candidate_user_id, other);
    await call(); assert.deepEqual(await rows(), first, 'repeat acknowledgements cannot rewrite generation history');
    await assert.rejects(call(other,source), /source unavailable/);
    await assert.rejects(call(viewer,source,[]), /invalid acknowledgement/);
    await assert.rejects(call(viewer,source,Array(33).fill(candidate)), /invalid acknowledgement/);
    await db.exec(`update profiles set is_banned=true where user_id='${viewer}'`);
    await assert.rejects(call(), /source unavailable/);
    await db.exec(`update profiles set is_banned=false where user_id='${viewer}'`);
    await db.exec(`insert into dating_1on1_candidate_impressions values('${viewer}','${uid(5)}',current_date-40,now()-interval '40 days'),
      ('${other}','${viewer}',current_date-40,now()-interval '40 days');`);
    await call();
    assert.equal((await rows()).length, 2, 'cleanup touches only the current viewer');
    assert.deepEqual(await query('select * from dating_1on1_cards order by id'), cardsBefore);
    assert.equal((await query("select count(*)::int n from pg_tables where schemaname='public'"))[0].n, 3, 'no quota/payment/match table is touched');
    await db.exec(`delete from auth.users where id='${viewer}'`);
    assert.equal((await rows()).length, 0, 'account erasure cascades in both directions');
  } finally { await db.close(); }
});
