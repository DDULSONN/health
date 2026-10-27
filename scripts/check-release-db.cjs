/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { run, validateContract, EXPECTED } = require('./check-production-db.cjs');
const root = path.resolve(__dirname, '..');
const sql = file => fs.readFileSync(path.join(root, 'supabase/sql', file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(callback) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table dating_1on1_cards(id uuid primary key,user_id uuid,name text,sex text,status text);
      create table dating_user_reports(reporter_user_id uuid,reported_user_id uuid,target_type text,target_id uuid,status text);
      create table dating_1on1_match_proposals(id uuid,source_user_id uuid,candidate_user_id uuid,state text,contact_exchange_status text,contact_exchange_paid_at timestamptz,contact_exchange_approved_at timestamptz);
      create table test_payments(id uuid,amount int);
      alter table dating_user_reports enable row level security;
      alter table dating_1on1_match_proposals enable row level security;
      grant select,insert,update on dating_user_reports,dating_1on1_match_proposals to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;`);
    await db.query('insert into auth.users values ($1),($2),($3)', [id(1),id(2),id(3)]);
    await db.query("insert into dating_1on1_match_proposals values ($1,$2,$3,'mutual_accepted','approved',now(),now())", [id(11),id(1),id(2)]);
    await db.query('insert into test_payments values($1,18000)',[id(21)]);
    const before = await db.query('select row_to_json(m) from dating_1on1_match_proposals m');
    await db.exec(sql('dating_candidate_hides.sql'));
    await db.exec(sql('dating_release_contract.sql'));
    const check = async () => (await db.query('select check_dating_release_contract() result')).rows[0].result;
    await callback({ db, check });
    assert.deepEqual(await db.query('select row_to_json(m) from dating_1on1_match_proposals m'),before);
    assert.equal((await db.query('select amount from test_payments')).rows[0].amount,18000);
    assert.equal((await db.query('select count(*)::int n from dating_user_reports')).rows[0].n,0);
  } finally { await db.close(); }
}
test('preflight detects the real missing-table failure; repair is idempotent and preserves existing blocks', () => fixture(async ({ db, check }) => {
  assert.equal((await check()).checks.find(c=>c.name==='dating_user_blocks').ok,false);
  await db.exec(sql('dating_user_blocks_repair.sql'));
  await db.query('insert into dating_user_blocks(blocker_user_id,blocked_user_id,reason) values($1,$2,$3)',[id(1),id(2),'개별 신고 사유']);
  await db.exec(sql('dating_user_blocks_repair.sql'));
  validateContract(await check());
  assert.equal((await db.query('select count(*)::int n from dating_user_blocks')).rows[0].n,1);
  assert.ok(!JSON.stringify(await check()).includes('개별 신고 사유'));
  await db.exec('begin read only'); validateContract(await check()); await db.exec('rollback');
}));
test('block SQL supports authenticated-server CRUD but denies all direct browser access', () => fixture(async ({ db, check }) => {
  await db.exec(sql('dating_user_blocks_repair.sql'));
  for (const role of ['anon','authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(db.query('select * from dating_user_blocks'),/permission denied/);
    await assert.rejects(db.query('insert into dating_user_blocks(blocker_user_id,blocked_user_id) values($1,$2)',[id(1),id(2)]),/permission denied/);
    await assert.rejects(check(),/permission denied/);
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  const save = reason => db.query('insert into dating_user_blocks(blocker_user_id,blocked_user_id,reason) values($1,$2,$3) on conflict(blocker_user_id,blocked_user_id) do update set reason=excluded.reason', [id(1),id(2),reason]);
  await save('신고 접수 자동 차단'); await save('재시도');
  assert.equal((await db.query('select count(*)::int n from dating_user_blocks')).rows[0].n,1);
  await assert.rejects(db.query('insert into dating_user_blocks(blocker_user_id,blocked_user_id) values($1,$1)',[id(1)]),/check constraint/);
  await assert.rejects(db.query('insert into dating_user_blocks(blocker_user_id,blocked_user_id) values($1,$2)',[id(1),id(99)]),/foreign key/);
  validateContract(await check());
  await db.query('delete from dating_user_blocks where blocker_user_id=$1 and blocked_user_id=$2',[id(3),id(2)]);
  assert.equal((await db.query('select count(*)::int n from dating_user_blocks')).rows[0].n,1);
  await db.query('delete from dating_user_blocks where blocker_user_id=$1 and blocked_user_id=$2',[id(1),id(2)]);
  await db.exec('reset role');
}));
for (const [label, change] of [
  ['missing column','alter table dating_user_blocks drop column reason'],
  ['RLS disabled','alter table dating_user_blocks disable row level security'],
  ['browser grant','grant select on dating_user_blocks to authenticated'],
  ['server permission revoked','revoke insert on dating_user_blocks from service_role'],
  ['missing function','drop function restore_dating_1on1_candidate(uuid,uuid)'],
  ['public function execute','grant execute on function hide_dating_1on1_candidate(uuid,uuid,uuid) to anon'],
  ['hidden direct writes','grant update on dating_1on1_candidate_hides to service_role'],
  ['missing pair uniqueness','alter table dating_user_blocks drop constraint dating_user_blocks_unique'],
]) test('preflight fails closed for ' + label, () => fixture(async ({ db, check }) => {
  await db.exec(sql('dating_user_blocks_repair.sql')); validateContract(await check());
  await db.exec(change); const result = await check(); assert.equal(result.ok,false); assert.throws(()=>validateContract(result),/failed/);
}));
const good = () => ({ version:1,ok:true,checks:EXPECTED.map(name=>({name,ok:true})) });
const env = { VERCEL:'1',VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://test-fixture.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-secret-never-log' };
test('only production build checks the DB; one bounded GET, no redirects, no member data or secret logs', async () => {
  let calls=0; const logs=[];
  const fetchImpl=async (url,options) => { calls++; assert.equal(url.pathname,'/rest/v1/rpc/check_dating_release_contract'); assert.equal(options.method,'GET'); assert.equal(options.redirect,'error'); assert.equal(options.body,undefined); assert.ok(options.signal); return Response.json(good()); };
  for (const config of [{},{...env,VERCEL_ENV:'preview'},{...env,VERCEL_ENV:'development'}]) await run({env:config,fetchImpl,log:s=>logs.push(s)});
  assert.equal(calls,0); await run({env,fetchImpl,log:s=>logs.push(s)}); assert.equal(calls,1);
  assert.ok(!logs.join('\n').includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
test('production missing config, malformed results, permission denial and network failures stop the release safely', async () => {
  const log=()=>{};
  for (const config of [{...env,SUPABASE_SERVICE_ROLE_KEY:''},{...env,NEXT_PUBLIC_SUPABASE_URL:'https://attacker.invalid'}, {...env,NEXT_PUBLIC_SUPABASE_URL:'https://test-fixture.supabase.co/?token=x'}]) {
    await assert.rejects(run({env:config,log,fetchImpl:()=>assert.fail('must not call network')}),/configuration/);
  }
  for (const body of [null,{}, {...good(),ok:false}, {...good(),version:2}, {...good(),checks:[]}, {...good(),checks:EXPECTED.map(()=>({name:EXPECTED[0],ok:true}))}, {...good(),checks:good().checks.map(c=>({...c,ok:'true'}))}]) {
    await assert.rejects(run({env,log,fetchImpl:async()=>Response.json(body)}),/preflight/);
  }
  for (const status of [401,403,404,503]) await assert.rejects(run({env,log,fetchImpl:async()=>new Response('PRIVATE_DATA',{status})}),error=>!error.message.includes('PRIVATE_DATA') && error.message.includes(String(status)));
  await assert.rejects(run({env,log,fetchImpl:async()=>{throw Error(env.SUPABASE_SERVICE_ROLE_KEY);}}),error=>!error.message.includes(env.SUPABASE_SERVICE_ROLE_KEY));
});
