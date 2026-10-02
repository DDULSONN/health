/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
function load(file, overrides = {}) {
  const m = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require','module','exports',code)(name => overrides[name] || (name.startsWith('@/') ? load(name.slice(2) + '.ts', overrides) : require(name)), m, m.exports);
  return m.exports;
}
const model = load('lib/return-profile-reward.ts');
const reward = state => ({ campaignKey: model.RETURN_PROFILE_CAMPAIGN, credits: 5, state });

test('strict response schema and narrowly scoped banner paths', () => {
  for (const state of ['eligible','ready','rewarded']) assert.ok(model.isReturnProfileReward(reward(state)));
  for (const value of [null, {}, reward('other'), { ...reward('ready'), credits: 50 }, { ...reward('ready'), campaignKey: 'other' }]) assert.equal(model.isReturnProfileReward(value), false);
  for (const p of ['/','/community/dating/cards','/dating/1on1','/mypage','/onboarding/dating']) assert.ok(model.showReturnRewardOnPath(p));
  for (const p of ['/login','/signup','/privacy','/admin','/mypage-other','/payments/success']) assert.equal(model.showReturnRewardOnPath(p), false);
});

test('API: verified caller only, no body, no caching, cross-origin rejected, GET read-only', async () => {
  let user = { id: 'alice' }, calls = [], fail = false;
  const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
  const route = load('app/api/return-profile-reward/route.ts', {
    'next/server': next,
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user }) },
    '@/lib/supabase/server': { createAdminClient: () => 'ADMIN' },
    '@/lib/return-profile-reward-server': { readReturnProfileReward: async (...args) => { calls.push(args); if (fail) throw Error('secret'); return reward('eligible'); } },
  });
  const request = (method, options = {}) => new Request('https://helchang.com/api/return-profile-reward?userId=mallory', { method, headers: { host: 'helchang.com', origin: 'https://helchang.com' }, ...options });
  let response = await route.GET(request('GET'));
  assert.deepEqual(await response.json(), { userId: 'alice', reward: reward('eligible') });
  assert.deepEqual(calls.pop(), ['ADMIN','alice',false]);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  response = await route.POST(request('POST'));
  assert.equal(response.status, 200); assert.deepEqual(calls.pop(), ['ADMIN','alice',true]);
  for (const body of ['{}', '{"userId":"mallory","credits":500}', ' '.repeat(1024)]) {
    assert.equal((await route.POST(request('POST', { body }))).status, 400);
  }
  assert.equal((await route.POST(request('POST', { headers: { host: 'helchang.com', origin: 'https://evil.invalid' } }))).status, 403);
  assert.equal(calls.length, 0);
  user = null;
  assert.equal((await route.GET(request('GET'))).status, 401);
  user = { id: 'deleted', deleted_at: '2026-01-01' };
  assert.equal((await route.POST(request('POST'))).status, 401);
  assert.equal(calls.length, 0);
  user = { id: 'alice' }; fail = true;
  response = await route.POST(request('POST'));
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes('secret'));
});

test('server integration: optional SQL hidden, invalid payload rejected, grant failure does not fail registration', async () => {
  const helper = load('lib/return-profile-reward-server.ts');
  let value = { data: reward('ready'), error: null }, names = [];
  const admin = { rpc: (name, args) => { names.push([name,args]); return { abortSignal: signal => { assert.ok(signal instanceof AbortSignal); return Promise.resolve(value); } }; } };
  assert.deepEqual(await helper.readReturnProfileReward(admin,'alice'), reward('ready'));
  assert.deepEqual(names.pop(), ['return_profile_reward_status', { p_user_id: 'alice' }]);
  for (const code of ['PGRST202','PGRST205','42883','42P01']) { value = { data: null, error: { code } }; assert.equal(await helper.readReturnProfileReward(admin,'alice'), null); }
  value = { data: { credits: 500 }, error: null };
  await assert.rejects(helper.readReturnProfileReward(admin,'alice'), /INVALID_RESPONSE/);
  value = { data: null, error: { code: 'XX000', message: 'private' } };
  await assert.rejects(helper.readReturnProfileReward(admin,'alice'), /UNAVAILABLE/);
  await helper.grantReturnProfileRewardSafely(admin,'alice');
  assert.deepEqual(names.pop(), ['claim_return_profile_reward', { p_user_id: 'alice' }]);
});

test('profile validation/upload/matching flow is unchanged except isolated post-response grant', () => {
  const file = 'app/api/dating/1on1/cards/route.ts';
  const baseline = execFileSync('git', ['show','0a63505ca60374c3aaac1d95f4dbc4334a173c6e:' + file], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
  const normalized = read(file)
    .replace('import { after, NextResponse } from "next/server";\nimport { grantReturnProfileRewardSafely } from "@/lib/return-profile-reward-server";', 'import { NextResponse } from "next/server";')
    .replace(/  \/\/ Optional benefit: never turn a successful registration into a failure\.\n  try \{\n    after\(\(\) => grantReturnProfileRewardSafely\(admin, user.id\)\);\n  \} catch \{\n    console.warn\("\[return-profile-reward\] deferred to next authenticated visit"\);\n  \}\n/, '');
  assert.equal(normalized, baseline);
});

test('real local PostgreSQL: frozen cohort, safety gates, atomic once-only credits, permissions, rollback', async () => {
  const db = new PGlite();
  const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
  const query = (sql, args = []) => db.query(sql, args);
  const status = async n => (await query('select return_profile_reward_status($1) as v', [id(n)])).rows[0].v;
  const claim = async n => (await query('select claim_return_profile_reward($1) as v', [id(n)])).rows[0].v;
  const credits = async n => (await query('select credits from user_apply_credits where user_id=$1', [id(n)])).rows[0]?.credits || 0;
  const memberCount = async () => (await query('select count(*)::int as n from return_profile_reward_members')).rows[0].n;
  const card = async (n, state = 'submitted', photos = ['a','b'], date = null) => query(`insert into dating_1on1_cards(user_id,status,photo_paths,created_at,
    sex,name,birth_year,height_cm,job,region,phone,intro_text,strengths_text,preferred_partner_text,smoking,
    consent_fake_info,consent_no_show,consent_fee,consent_privacy)
    values($1,$2,$3::jsonb,coalesce($4::timestamptz,clock_timestamp()),
    'male','가상회원',1996,175,'직장인','서울','01000000000','테스트 소개','장점','이상형','non_smoker',true,true,true,true) returning id`,
    [id(n),state,JSON.stringify(photos.map(p=>'cards/'+id(n)+'/'+p)),date]);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, created_at timestamptz not null default now()-interval '4 months', last_sign_in_at timestamptz, deleted_at timestamptz, banned_until timestamptz);
      create table auth.sessions(user_id uuid, created_at timestamptz, updated_at timestamptz);
      create table profiles(user_id uuid primary key references auth.users(id) on delete cascade, role text default 'user', is_banned boolean default false, phone_verified boolean default true, last_meaningful_activity_at timestamptz);
      create table dating_cards(id uuid default gen_random_uuid(), owner_user_id uuid references auth.users(id) on delete cascade, created_at timestamptz);
      create table onboarding_funnel_events(user_id uuid references auth.users(id) on delete cascade, first_seen_at timestamptz);
    `);
    // Use the checked-in production table definitions, not hand-written lookalikes.
    for (const [file,table] of [['dating_1on1_cards.sql','dating_1on1_cards'],['dating_apply_credits.sql','user_apply_credits'],['dating_apply_credits.sql','apply_credit_orders']]) {
      const definition=read('supabase/sql/'+file).match(new RegExp('create table if not exists public\\.'+table+' \\([\\s\\S]*?\\n\\);'))?.[0];
      assert.ok(definition,table+' schema found'); await db.exec(definition);
    }
    await db.exec('alter table dating_1on1_cards add column recommendation_refresh_used_at timestamptz');
    for (let n=1;n<=24;n++) {
      await query('insert into auth.users(id) values($1)', [id(n)]);
      await query('insert into profiles(user_id) values($1)', [id(n)]);
    }
    // One disqualifying activity source per member, and three existing-active-card states.
    await query('update auth.users set created_at=now() where id=$1', [id(2)]);
    await query('update auth.users set last_sign_in_at=now() where id=$1', [id(3)]);
    await query('update profiles set last_meaningful_activity_at=now() where user_id=$1', [id(4)]);
    await query('insert into auth.sessions values($1,now()-interval \'4 months\',now())', [id(5)]);
    await query('insert into onboarding_funnel_events values($1,now())', [id(6)]);
    await query('insert into dating_cards(owner_user_id,created_at) values($1,now()),($2,now()-interval \'4 months\')', [id(7),id(16)]);
    await card(8,'rejected');
    const old = new Date(Date.now()-150*86400000).toISOString();
    for (const [n,state] of [[9,'submitted'],[10,'reviewing'],[11,'approved'],[12,'rejected'],[17,'rejected']]) await card(n,state,['a','b'],old);
    await query('update dating_1on1_cards set recommendation_refresh_used_at=now() where user_id=$1', [id(12)]);
    await query('update profiles set is_banned=true where user_id=$1', [id(13)]);
    await query('update profiles set role=\'admin\' where user_id=$1', [id(14)]);
    await query('update auth.users set deleted_at=now() where id=$1', [id(15)]);
    await query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1', [id(18)]);
    await query('update profiles set phone_verified=false where user_id=$1', [id(19)]);
    await query('insert into user_apply_credits values($1,7,now())', [id(1)]);
    // Supabase defaults can be broader than vanilla PostgreSQL defaults.
    await db.exec('alter default privileges in schema public grant all on tables to anon, authenticated, service_role');
    const sql = read('supabase/sql/return_profile_reward.sql');
    await db.exec(sql); await db.exec(sql);
    assert.equal(await memberCount(), 0); assert.equal(await status(1), null);
    assert.equal(await claim(1), null); assert.equal(await credits(1), 7);
    await db.exec(read('supabase/sql/return_profile_reward_activate.sql'));
    const cohort = (await query('select user_id from return_profile_reward_members order by user_id')).rows.map(r => r.user_id);
    assert.deepEqual(cohort, [1,16,17,19,20,21,22,23,24].map(id));
    assert.equal(await credits(1), 7, 'activation never grants credits');
    const times = (await query('select activated_at,inactivity_cutoff, ((activated_at at time zone \'Asia/Seoul\')-interval \'3 months\') at time zone \'Asia/Seoul\' as expected from return_profile_reward_campaign')).rows[0];
    assert.deepEqual(times.inactivity_cutoff, times.expected);
    for (const n of [1,16,17,19]) assert.deepEqual(await status(n), reward('eligible'));
    // Logging in after enrollment must not erase the offer; reruns must not add newly eligible users.
    await query('update auth.users set last_sign_in_at=now() where id=$1', [id(1)]);
    await query('update auth.users set last_sign_in_at=null where id=$1', [id(3)]);
    await db.exec(sql); await db.exec(read('supabase/sql/return_profile_reward_activate.sql'));
    assert.equal(await memberCount(), cohort.length); assert.equal(await status(3), null);
    assert.equal(await claim(1).then(v => v.state), 'eligible');
    await card(1); assert.deepEqual(await status(1), reward('ready'));
    assert.equal(await credits(1),7,'status GET never grants');
    // Roll back a later ledger failure: no credit increment or consumed eligibility survives.
    await db.exec("alter table apply_credit_orders add constraint test_reject check(amount<>0)");
    await assert.rejects(claim(1), /check constraint/);
    assert.equal(await credits(1),7); assert.equal((await status(1)).state,'ready');
    await db.exec('alter table apply_credit_orders drop constraint test_reject');
    const outcomes = await Promise.all(Array.from({length:8},() => claim(1)));
    assert.ok(outcomes.every(v => v.state === 'rewarded')); assert.equal(await credits(1),12);
    assert.equal((await query('select count(*)::int as n from apply_credit_orders where user_id=$1',[id(1)])).rows[0].n,1);
    // Old/rejected cards, missing photos and no phone cannot grant; correcting it can.
    await card(19); assert.equal((await claim(19)).state,'eligible'); assert.equal(await credits(19),0);
    await query('update profiles set phone_verified=true where user_id=$1',[id(19)]);
    assert.equal((await claim(19)).state,'rewarded'); assert.equal(await credits(19),5);
    assert.equal((await claim(17)).state,'eligible');
    await card(17,'rejected'); assert.equal((await claim(17)).state,'eligible');
    await card(17,'submitted',['a']); assert.equal((await claim(17)).state,'eligible');
    for(const invalid of [{},'not-an-array',[null,null],[1,2],['other-member/a','other-member/b'],[]]) {
      await query('update dating_1on1_cards set photo_paths=$2::jsonb where user_id=$1',[id(17),JSON.stringify(invalid)]);
      assert.equal((await status(17)).state,'eligible'); assert.equal((await claim(17)).state,'eligible');
    }
    await card(17,'submitted'); assert.equal((await claim(17)).state,'rewarded');
    await card(20); await query('update profiles set is_banned=true where user_id=$1',[id(20)]);
    assert.equal(await claim(20),null); assert.equal(await status(20),null); assert.equal(await credits(20),0);
    await card(21); await query('update auth.users set deleted_at=now() where id=$1',[id(21)]);
    assert.equal(await claim(21),null); assert.equal(await credits(21),0);
    await card(22); await query('update auth.users set banned_until=now()+interval \'1 day\' where id=$1',[id(22)]);
    assert.equal(await claim(22),null); assert.equal(await credits(22),0);
    // Disabled campaign stops all future grants; schema reruns never re-enable it.
    await db.exec('update return_profile_reward_campaign set enabled=false'); await card(23);
    await db.exec(sql); await db.exec(read('supabase/sql/return_profile_reward_activate.sql'));
    assert.equal(await claim(23),null); assert.equal(await status(1),null); assert.equal(await credits(23),0);
    await db.exec('update return_profile_reward_campaign set enabled=true');
    // Browser roles cannot enumerate the cohort or call any security-definer function.
    for (const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      for (const stmt of ['select * from return_profile_reward_members','select * from return_profile_reward_campaign','select activate_return_profile_reward()',`select return_profile_reward_status('${id(1)}')`,`select claim_return_profile_reward('${id(23)}')`]) await assert.rejects(query(stmt), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await claim(23)).state,'rewarded');
    await assert.rejects(query('update return_profile_reward_members set rewarded_at=null'), /permission denied/);
    await db.exec('reset role');
    await query('delete from dating_1on1_cards where user_id=$1',[id(1)]); await card(1);
    assert.equal((await claim(1)).state,'rewarded'); assert.equal(await credits(1),12,'re-registering never doubles reward');
    await query('delete from apply_credit_orders where user_id=$1',[id(1)]);
    assert.equal((await claim(1)).state,'rewarded'); assert.equal(await credits(1),12,'ledger deletion does not reset reward');
    await query('delete from auth.users where id=$1',[id(24)]);
    await query('insert into auth.users(id) values($1)',[id(24)]); await query('insert into profiles(user_id) values($1)',[id(24)]);
    await db.exec(read('supabase/sql/return_profile_reward_activate.sql'));
    assert.equal(await status(24),null,'deleted/recreated account is not re-enrolled');
  } finally { await db.close(); }
});
