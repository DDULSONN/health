/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const json = (body, init) => Response.json(body, init);
function load(file, overrides = {}, env = {}) {
  const mod = { exports: {} };
  const output = ts.transpileModule(read(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', 'process', output)(name => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name === 'next/server') return { NextResponse: { json }, after: fn => fn() };
    if (name.startsWith('node:')) return require(name);
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', overrides, env);
    throw Error('Unexpected import ' + name);
  }, mod, mod.exports, { env });
  return mod.exports;
}
const attempt = { id: id(1), user_id: id(2), source_card_id: id(3), expected_refresh_at: null,
  planned_at: '2026-10-23T01:00:00.000Z', source_profile_key: 'key', outcome: 'failed', persist_page: true,
  changed_count: 1, rotated_count: 1, before_candidate_ids: [id(4)], before_user_ids: [id(5)],
  after_user_ids: [id(6)], main_candidate_ids: [id(7)], extra_candidate_ids: [], pool_count: 50, safe_local_change: true };
const plan = { source_card_id: id(3), expected_refresh_used_at: null, refresh_at: '2026-10-23T02:00:00.000Z',
  source_profile_key: 'key', persist_page: true, changed_candidate_count: 1, rotated_candidate_count: 1,
  refresh_remaining: 0, refresh_limit: 1, refresh_used_count: 1, refresh_bonus_remaining: 0,
  main_candidate_ids: [id(7)], extra_candidate_ids: [], monitor: { safe_local_change: true,
    before_candidate_ids: [id(4)], before_user_ids: [id(5)], after_user_ids: [id(6)], pool_count: 50 } };
const job = { id: id(8), user_id: id(2), attempt_id: id(1), lease_token: id(9), day_key: '2026-10-22' };
function fixture(opts = {}) {
  const writes = [], calls = [], reads = [], emails = [];
  const admin = { from: table => {
    let patch, filters = [];
    const q = { select: () => q, eq: (k,v) => { filters.push([k,v]); return q; }, in: () => q, gte: () => q,
      order: () => q, limit: () => q, lte: () => q, maybeSingle: () => q, single: () => q,
      update: value => { patch = value; writes.push({ table, value }); return q; }, then: (resolve,reject) => {
        reads.push(table);
        let data = [];
        if (table.endsWith('_settings')) data = { mode: opts.mode ?? 'repair', email_enabled: opts.emailEnabled !== false };
        if (table === 'profiles') data = opts.deleted ? null : { is_banned: !!opts.banned };
        if (table === 'dating_1on1_cards') data = opts.staleCard ? null : { id: id(3) };
        if (table === 'dating_1on1_refresh_attempts') data = opts.history ?? { source_card_id: id(3) };
        if (table === 'dating_1on1_refresh_audits') data = patch ? (opts.reserved ? [] : [{ id: job.id }])
          : [{ id: job.id, user_id: job.user_id, attempt_id: job.attempt_id, repaired_at: plan.refresh_at }];
        return Promise.resolve({ data, error: opts.readError ? { code: opts.readError } : null }).then(resolve,reject);
      } }; return q;
  }, rpc: async (name,args) => { calls.push([name,args]); return { data: opts.repaired !== false, error: opts.rpcError ? {} : null }; } };
  const deps = {
    '@/lib/dating-1on1-recommendation-service': { loadOneOnOneRecommendations: async () => opts.planError ? json({}, { status: 503 }) : json({ plan: opts.plan ?? plan }) },
    '@/lib/dating-1on1-reminders': { isOneOnOneReminderHour: () => !opts.night },
    '@/lib/dating-swipe': { sendDatingEmailNotification: async (_a,user,subject,text,beforeSend,key) => {
      emails.push({ user, subject, text, key }); if (opts.emailThrows) throw Error('uncertain');
      return !opts.unsubscribed && await beforeSend();
    } },
  };
  const api = load('lib/dating-1on1-refresh-monitor.ts', deps, opts.noMailConfig ? {} : { RESEND_API_KEY: 'synthetic', NOTIFY_FROM_EMAIL: 'test@invalid.local' });
  return { admin, api, writes, calls, emails, deps, reads };
}

for (const [name, a, p, expected] of [
  ['confirmed save failure with still available local alternative', attempt, plan, 'repair_ready'],
  ['normal refresh', { ...attempt, outcome: 'changed' }, undefined, 'healthy'],
  ['quota exhaustion', { ...attempt, outcome: 'limited' }, undefined, 'quota_limit'],
  ['concurrent refresh', { ...attempt, outcome: 'conflict' }, undefined, 'superseded'],
  ['small pool', { ...attempt, outcome: 'unchanged', pool_count: 1 }, undefined, 'pool_small'],
  ['unchanged large pool is only a suspicion', { ...attempt, outcome: 'unchanged' }, plan, 'repeat_review'],
  ['same people different positions', { ...attempt, outcome: 'rotated', after_user_ids: [id(5)] }, undefined, 'repeat_review'],
  ['uncertain commit actually advanced seed', attempt, { ...plan, expected_refresh_used_at: attempt.planned_at }, 'superseded'],
  ['changed profile settings', attempt, { ...plan, source_profile_key: 'new' }, 'superseded'],
  ['replacement profile', attempt, { ...plan, source_card_id: id(99) }, 'superseded'],
  ['no persisted page schema', attempt, { ...plan, persist_page: false }, 'repair_review'],
  ['distant or wrong age repair refused', attempt, { ...plan, monitor: { safe_local_change: false } }, 'repair_review'],
  ['original failed request was already distant', { ...attempt, safe_local_change: false }, plan, 'repair_review'],
  ['only newcomers now exist', attempt, { ...plan, main_candidate_ids: [id(88)] }, 'repair_review'],
  ['planner fails', attempt, undefined, 'check_failed'],
  ['too many distant candidates is review-only', { ...attempt, outcome: 'changed', widened_count: 1 }, undefined, 'fit_review'],
  ['too many age mismatches is review-only', { ...attempt, outcome: 'changed', age_mismatch_count: 1 }, undefined, 'fit_review'],
]) test(`classification: ${name}`, () => assert.equal(fixture().api.classifyRefreshAudit(a, p), expected));

test('observation mode never repairs or sends, repair mode uses one atomic RPC', async () => {
  const f = fixture();
  assert.equal(await f.api.auditRefreshAttempt(f.admin, job, attempt, 'observe'), 'repair_ready');
  assert.equal(f.calls.length, 0); assert.equal(f.emails.length, 0);
  const g = fixture(); assert.equal(await g.api.auditRefreshAttempt(g.admin, job, attempt, 'repair'), 'repaired');
  assert.equal(g.calls.length, 1); assert.equal(g.calls[0][0], 'repair_dating_1on1_refresh_audit');
  assert.equal(g.writes.length, 0); assert.equal(g.emails.length, 0);
});
test('uncertain transaction is not retried and does not claim success', async () => {
  const f = fixture({ rpcError: true });
  await assert.rejects(f.api.auditRefreshAttempt(f.admin, job, attempt, 'repair'), /UNCERTAIN/);
  assert.equal(f.calls.length, 1); assert.equal(f.writes.length, 0); assert.equal(f.emails.length, 0);
});
test('changed state skips recovery without consuming normal or bonus quota', async () => {
  const f = fixture({ repaired: false });
  assert.equal(await f.api.auditRefreshAttempt(f.admin, job, attempt, 'repair'), 'superseded');
  assert.ok(f.writes.every(w => w.table === 'dating_1on1_refresh_audits'));
});
test('two high-overlap refreshes are flagged but never replaced or emailed automatically', async () => {
  const row = { before_user_ids: [id(1),id(2),id(3),id(4),id(5)], after_user_ids: [id(1),id(2),id(3),id(4),id(6)] };
  const f=fixture({history:[row,row]});
  assert.equal(await f.api.auditRefreshAttempt(f.admin,job,{...attempt,outcome:'changed'},'repair'),'repeat_review');
  assert.equal(f.calls.length,0);assert.equal(f.emails.length,0);
  const g=fixture({history:[row]});
  assert.equal(await g.api.auditRefreshAttempt(g.admin,job,{...attempt,outcome:'changed'},'repair'),'healthy');
});
test('a missing history read is not misreported as a clean bill of health', async () => {
  const f=fixture({readError:'57014'});
  await assert.rejects(f.api.auditRefreshAttempt(f.admin,job,{...attempt,outcome:'changed'},'repair'),/HISTORY_FAILED/);
  assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
});
for (const opts of [{ night: true }, { noMailConfig: true }, { mode: 'observe' }, { emailEnabled: false }, { reserved: true }])
  test('mail is gated: ' + JSON.stringify(opts), async () => {
    const f = fixture(opts); assert.equal(await f.api.deliverRefreshRepairEmails(f.admin, Date.now() + 45000), 0); assert.equal(f.emails.length, 0);
  });
for (const opts of [{}, { banned: true }, { deleted: true }, { staleCard: true }, { unsubscribed: true }, { emailThrows: true }])
  test('mail current-state recheck and reservation: ' + JSON.stringify(opts), async () => {
    const f = fixture(opts), sent = await f.api.deliverRefreshRepairEmails(f.admin, Date.now() + 45000);
    assert.equal(sent, Object.keys(opts).length ? 0 : 1);
    assert.equal(f.writes[0].value.email_state, 'sending');
    assert.equal(f.writes.at(-1).value.email_state, sent ? 'sent' : 'unknown');
    assert.equal(f.emails[0].key, 'refresh-repair-' + job.id);
    assert.ok(f.emails[0].text.includes('횟수를 사용하지 않았습니다')); assert.doesNotMatch(f.emails[0].text, /�|할인|혜택/);
  });

test('observation runs after response; missing SQL and failed after context cannot fail refresh', async () => {
  let deferred, snapshot;
  const deps = { 'next/server': { after: fn => { deferred = fn; } } };
  const f = load('lib/dating-1on1-refresh-monitor-record.ts', deps);
  const admin = { from: name => ({ insert: value => { assert.equal(name, 'dating_1on1_refresh_attempts'); snapshot = value;
    return { abortSignal: async signal => { assert.ok(signal instanceof AbortSignal); return { error: { code: '42P01' } }; } }; } }) };
  f.recordRefreshAttempt(admin, id(2), id(1), plan, 'failed');
  assert.equal(snapshot, undefined); await deferred();
  assert.equal(snapshot.outcome, 'failed'); assert.ok(!JSON.stringify(snapshot).includes('phone'));
  const bad = load('lib/dating-1on1-refresh-monitor-record.ts', { 'next/server': { after: () => { throw Error(); } } });
  assert.doesNotThrow(() => bad.recordRefreshAttempt(admin, id(2), id(1), plan, 'changed'));
});
test('read failure with no plan records only an owned active source and cannot be auto-repaired', async () => {
  for(const owns of [true,false]){
    let deferred,snapshot;const filters=[];
    const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},in:()=>q,abortSignal:()=>q,
      maybeSingle:async()=>({data:owns?{id:id(3),sex:'male',birth_year:1995,region:'서울',recommendation_refresh_used_at:null}:null})};
    const admin={from:table=>table==='dating_1on1_cards'?q:{insert:value=>{snapshot=value;return{abortSignal:async()=>({error:null})};}}};
    const f=load('lib/dating-1on1-refresh-monitor-record.ts',{'next/server':{after:fn=>{deferred=fn;}}});
    f.recordRefreshAttempt(admin,id(2),id(1),undefined,'failed',id(3));await deferred();
    assert.ok(filters.some(([k,v])=>k==='user_id'&&v===id(2)));
    if(owns){assert.equal(snapshot.persist_page,false);assert.equal(snapshot.safe_local_change,false);assert.deepEqual(snapshot.main_candidate_ids,[]);}
    else assert.equal(snapshot,undefined);
  }
});

test('cron denies absent/wrong secret even with Vercel header; no DB reads when denied', async () => {
  for (const [secret, auth, status] of [[undefined, 'Bearer undefined', 401], ['test', '', 401], ['test', 'Bearer testx', 401], ['test', 'Bearer test', 200]]) {
    let touched = 0;
    const api = load('app/api/cron/dating-1on1-refresh-monitor/route.ts', {
      '@/lib/supabase/server': { createAdminClient: () => { touched++; return {}; } },
      '@/lib/dating-1on1-refresh-monitor': { runRefreshMonitor: async () => ({ checked: 0 }) },
    }, { CRON_SECRET: secret });
    const res = await api.GET(new Request('http://localhost/api/cron/test', { headers: { authorization: auth, 'x-vercel-cron': '1' } }));
    assert.equal(res.status, status); assert.equal(touched, status === 200 ? 1 : 0);
  }
});

test('admin GET/PATCH require authorization and same-origin writes', async () => {
  for (const denied of [401,403]) {
    const api = load('app/api/admin/dating/1on1/refresh-monitor/route.ts', {
      '@/lib/admin-route': { requireAdminRoute: async () => ({ ok: false, response: json({}, { status: denied }) }) },
      '@/lib/request-origin': { ensureAllowedMutationOrigin: () => null },
    });
    assert.equal((await api.GET(new Request('http://localhost/api/admin/test'))).status, denied);
    assert.equal((await api.PATCH(new Request('http://localhost/api/admin/test', { method: 'PATCH' }))).status, denied);
  }
  const api = load('app/api/admin/dating/1on1/refresh-monitor/route.ts', {
    '@/lib/admin-route': { requireAdminRoute: async () => { throw Error('must not authenticate'); } },
    '@/lib/request-origin': { ensureAllowedMutationOrigin: () => json({}, { status: 403 }) },
  });
  assert.equal((await api.PATCH(new Request('http://localhost', { method: 'PATCH' }))).status,403);
});
