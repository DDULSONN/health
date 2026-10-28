/* eslint-disable @typescript-eslint/no-require-imports */
// Offline PostgreSQL checks. Never loads .env or contacts a payment provider.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
// Git archives and Windows checkouts can use different line endings. PostgreSQL
// retains function-body whitespace, so compare the same canonical source text.
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table profiles(user_id uuid primary key,nickname text default '검증회원',role text default 'user',is_banned boolean default false,phone_verified boolean default true,phone_e164 text);
    create table dating_1on1_cards(id uuid primary key,user_id uuid,name text,birth_year int default 1995,status text default 'approved');
    create table dating_1on1_match_proposals(id uuid primary key,source_user_id uuid,candidate_user_id uuid,source_card_id uuid,candidate_card_id uuid,
      state text default 'mutual_accepted',contact_exchange_status text default 'awaiting_applicant_payment',contact_exchange_requested_at timestamptz,
      contact_exchange_paid_at timestamptz,contact_exchange_paid_by_user_id uuid,contact_exchange_approved_at timestamptz,
      contact_exchange_approved_by_user_id uuid,contact_exchange_note text,updated_at timestamptz,created_at timestamptz default now(),
      source_phone_share_consented_at timestamptz,candidate_phone_share_consented_at timestamptz,admin_sent_by_user_id uuid,
      source_selected_at timestamptz,candidate_responded_at timestamptz,source_final_responded_at timestamptz);
    create table toss_test_payment_orders(id uuid primary key,user_id uuid,product_type text default 'one_on_one_contact_exchange',product_ref_id uuid,
      status text default 'paid',amount int default 20000,approved_at timestamptz default now()-interval '2 days',payment_key text,cancel_amount int,canceled_at timestamptz,
      toss_order_id text,created_at timestamptz default now(),updated_at timestamptz);
    create table dating_1on1_plus_subscriptions(user_id uuid,expires_at timestamptz,contact_exchange_included boolean);
    create table dating_1on1_admin_user_blocks(user_a_id uuid,user_b_id uuid);
    create table dating_user_blocks(blocker_user_id uuid,blocked_user_id uuid);
    create table dating_contact_blocks(user_id uuid,block_type text,value_hash text);
    create table dating_1on1_phone_blocks(user_id uuid,phone_hash text);
    create table app_purchase_events(user_id uuid);
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon,authenticated,service_role;
    grant all on storage.objects to anon,authenticated,service_role;
    create policy unrelated_public_policy on storage.objects for all to anon,authenticated using(true) with check(true);
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  `);
  try { await db.exec(read('supabase/sql/contact_care.sql')); await db.exec(read('supabase/sql/contact_care_evidence.sql')); await db.exec(read('supabase/sql/contact_care_manual_vouchers.sql')); } catch (e) { await db.close(); throw e; }
  const q = (sql, args = []) => db.query(sql, args);
  const rpc = async (name, args) => (await q(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) v`, args)).rows[0].v;
  await q('insert into auth.users(id) values($1),($2),($3),($4)', [id(1),id(2),id(3),id(4)]);
  await q(`insert into profiles(user_id,phone_e164,role) values($1,'+821011111111','user'),($2,'+821022222222','user'),($3,'+821033333333','user'),($4,'+821044444444','admin')`, [id(1),id(2),id(3),id(4)]);
  await q(`insert into dating_1on1_cards(id,user_id,name) values($1,$1,'내 프로필'),($2,$2,'이전 상대'),($3,$3,'새 상대')`, [id(1),id(2),id(3)]);
  await q(`insert into dating_1on1_match_proposals(id,source_user_id,candidate_user_id,source_card_id,candidate_card_id,contact_exchange_status,contact_exchange_approved_at,contact_exchange_paid_at,contact_exchange_paid_by_user_id)
    values($1,$2,$3,$2,$3,'approved',now()-interval '2 days',now()-interval '2 days',$2)`, [id(10),id(1),id(2)]);
  await q('insert into dating_1on1_match_proposals(id,source_user_id,candidate_user_id,source_card_id,candidate_card_id) values($1,$2,$3,$2,$3)', [id(20),id(1),id(3)]);
  await q('insert into toss_test_payment_orders(id,user_id,product_ref_id) values($1,$2,$3)', [id(100),id(1),id(10)]);
  const activate = () => db.exec(`update contact_care_policy set enabled=true,starts_at=now()-interval '6 days'`);
  let lastUpload;
  const upload = async (user=id(1),match=id(10),order=id(100),count=1) => {
    const u=await rpc('reserve_contact_care_upload',[user,match,order,count]);
    for(const name of u.paths) await q("insert into storage.objects values('contact-care-evidence',$1)",[name]);
    return u;
  };
  const apply = async (overrides = []) => {
    const claim=(await q('select * from contact_care_claims')).rows[0];
    const args=[id(1),id(10),id(100),new Date(Date.now()-36*3600000).toISOString(),'카톡으로 첫 연락을 했고 답장이 오지 않았습니다.','no_response',null,claim?.id??null].map((v,i)=>overrides[i]===undefined?v:overrides[i]);
    if(claim?.status==='pending'||claim?.status==='approved') args[6]=claim.upload_id;
    else {
      if(!lastUpload || claim) lastUpload=await upload(args[0],args[1],args[2]);
      args[6]=lastUpload.id;
    }
    return rpc('submit_contact_care',args);
  };
  const approve = async (claim, overrides = []) => rpc('review_contact_care', [claim,id(4),'approved',true,'증빙 확인 후 1장을 지급합니다.'].map((v,i) => overrides[i] === undefined ? v : i===2 && typeof overrides[i]==='boolean' ? overrides[i]?'approved':'rejected' : overrides[i]));
  const redeem = (overrides = []) => rpc('redeem_contact_care', [id(1),id(20),['+821011111111','+821033333333'],['hash1','hash3'],['legacy1','legacy3']].map((v,i) => overrides[i] === undefined ? v : overrides[i]));
  const ready = async () => { await activate(); const c = await apply(); await approve(c.id); return c; };
  const status = async () => (await q('select * from contact_care_claims')).rows[0];
  return { db,q,rpc,activate,apply,approve,redeem,ready,status,upload };
}
async function withDb(fn) { const f = await fixture(); try { await fn(f); } finally { await f.db.close(); } }

async function careCheckoutFixture(f, { manual = false, provider } = {}) {
  if (manual) await grantManual(f); else await f.ready();
  await f.q(`insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at,toss_order_id)
    values($1,$2,$3,'ready',null,'expired_checkout_001')`, [id(101),id(3),id(20)]);
  const base = client(f); let calls = 0, rpcCalls = 0;
  const db = { ...base, rpc: async (...args) => { rpcCalls++; return base.rpc(...args); } };
  const api = load('app/api/dating/1on1/contact-care/route.ts', {
    'next/server': { NextResponse: { json: (body,init) => Response.json(body,init) } },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({ user: { id:id(1) } }) },
    '@/lib/supabase/server': { createAdminClient: () => db },
    '@/lib/dating-contact-blocks': { normalizeDatingContactPhone:p=>p,hashDatingContactBlockValue:(_,p)=>p.endsWith('1111')?'hash1':'hash3' },
    '@/lib/dating-1on1-phone-blocks': { hashOneOnOneBlockedPhone:p=>p.endsWith('1111')?'legacy1':'legacy3' },
    '@/lib/toss-payments': { getTossPaymentByOrderId: async orderId => {
      calls++;
      return provider ? provider(orderId,f) : { orderId,status:'EXPIRED',totalAmount:20000,approvedAt:null };
    } },
  });
  return {
    post: (overrides={}) => api.POST(new Request('https://local.invalid/api', { method:'POST',
      headers:{host:'local.invalid',origin:'https://local.invalid','content-type':'application/json'},
      body:JSON.stringify({action:manual?'redeem_manual':'redeem',matchId:id(20),confirmed:true,...overrides}),
    })),
    order: async () => (await f.q('select * from toss_test_payment_orders where id=$1',[id(101)])).rows[0],
    calls: () => calls, rpcCalls: () => rpcCalls,
  };
}

for (const manual of [false,true]) test(`expired checkout recovery -> locked redemption is idempotent (${manual?'manual':'claim'})`, () => withDb(async f => {
  const before = await f.q('select * from toss_test_payment_orders');
  const api = await careCheckoutFixture(f,{manual});
  const r = await api.post();assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
  assert.equal((await api.order()).status,'canceled');assert.equal(api.calls(),1);assert.equal(api.rpcCalls(),2);
  assert.equal((await f.q('select contact_exchange_status s from dating_1on1_match_proposals where id=$1',[id(20)])).rows[0].s,'approved');
  assert.equal((await (await api.post()).json()).alreadyUsed,true);assert.equal(api.calls(),1);
  if (manual) assert.equal(await manualRemaining(f),2); else assert.equal((await f.status()).used_match_id,id(20));
  assert.deepEqual(await f.q('select * from toss_test_payment_orders where id=$1',[id(100)]),before);
  await assert.rejects(f.q("insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at) values($1,$2,$3,'ready',null)",[id(200),id(3),id(20)]),/CARE_ALREADY_EXCHANGED/);
}));

const careProviderUnsafe = [
  ...['READY','IN_PROGRESS','WAITING_FOR_DEPOSIT','DONE','CANCELED','PARTIAL_CANCELED',undefined,'UNKNOWN'].map(status=>({status})),
  {orderId:'another_order'}, {totalAmount:18000}, {totalAmount:'20000'}, {approvedAt:'2026-10-28T00:00:00Z'},
  {cancels:[{cancelAmount:20000}]}, {cancels:{}},
];
for (const variant of careProviderUnsafe) test('checkout stays blocked for provider '+JSON.stringify(variant), () => withDb(async f => {
  const api = await careCheckoutFixture(f,{provider:async orderId=>({orderId,status:'EXPIRED',totalAmount:20000,approvedAt:null,...variant})});
  assert.equal((await api.post()).status,409);assert.equal((await api.order()).status,'ready');
  assert.equal((await f.status()).used_at,null);assert.equal(api.rpcCalls(),1);
}));

for (const status of ['ABORTED','EXPIRED']) test('unapproved terminal provider state '+status+' allows voucher without another payment', () => withDb(async f => {
  const api = await careCheckoutFixture(f,{provider:async orderId=>({orderId,status,totalAmount:20000})});
  assert.equal((await api.post()).status,200);assert.equal((await api.order()).status,'canceled');
}));

for (const message of ['timeout','404 NOT_FOUND_PAYMENT','503 provider unavailable']) test('provider lookup '+message+' cannot spend voucher', () => withDb(async f => {
  const api=await careCheckoutFixture(f,{provider:async()=>{throw Error(message);}});
  assert.equal((await api.post()).status,409);assert.equal((await api.order()).status,'ready');assert.equal((await f.status()).used_at,null);
}));

test('failed initial RPC never cleans orders on no credit, changed match or foreign target', () => withDb(async f => {
  const api=await careCheckoutFixture(f);
  assert.equal((await api.post({confirmed:false})).status,400);
  assert.equal((await api.post({matchId:id(999)})).status,404);
  await f.q("update contact_care_claims set status='rejected'");
  assert.equal((await api.post()).status,409);assert.equal(api.calls(),0);
  await f.q("update contact_care_claims set status='approved'");
  await f.q("update dating_1on1_match_proposals set state='candidate_rejected' where id=$1",[id(20)]);
  assert.equal((await api.post()).status,409);assert.equal(api.calls(),0);assert.equal((await api.order()).status,'ready');
}));

for (const change of ["status='paid'", "payment_key='existing-key'", "approved_at=now()", "cancel_amount=1", "canceled_at=now()", "user_id='"+id(4)+"'"]) test('local payment evidence blocks cleanup: '+change, () => withDb(async f => {
  const api=await careCheckoutFixture(f);await f.q('update toss_test_payment_orders set '+change+' where id=$1',[id(101)]);
  const before=await api.order();assert.equal((await api.post()).status,409);assert.deepEqual(await api.order(),before);
  assert.equal(api.calls(),0);assert.equal((await f.status()).used_at,null);
}));

test('mixed active and expired orders are not partially cleaned; max eight provider reads', () => withDb(async f => {
  const api=await careCheckoutFixture(f,{provider:async orderId=>({orderId,status:orderId==='expired_checkout_001'?'EXPIRED':'IN_PROGRESS',totalAmount:20000})});
  await f.q("insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at,toss_order_id) values($1,$2,$3,'ready',null,'active_checkout_002')",[id(102),id(1),id(20)]);
  assert.equal((await api.post()).status,409);assert.equal((await api.order()).status,'ready');assert.equal(api.calls(),2);
  for(let n=103;n<=109;n++) await f.q("insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at,toss_order_id) values($1,$2,$3,'ready',null,$4)",[id(n),id(1),id(20),'extra_checkout_'+n]);
  assert.equal((await api.post()).status,409);assert.equal(api.calls(),2);assert.equal((await f.status()).used_at,null);
}));

test('approval racing provider lookup is not overwritten and does not spend credit', () => withDb(async f => {
  const api=await careCheckoutFixture(f,{provider:async(orderId)=>{
    await f.q("update toss_test_payment_orders set status='paid',payment_key='approved-key',approved_at=now() where id=$1",[id(101)]);
    return {orderId,status:'EXPIRED',totalAmount:20000};
  }});
  assert.equal((await api.post()).status,409);assert.equal((await api.order()).status,'paid');assert.equal((await f.status()).used_at,null);assert.equal(api.rpcCalls(),1);
}));

test('new checkout arriving during cleanup is caught by unchanged redemption lock/check', () => withDb(async f => {
  const api=await careCheckoutFixture(f,{provider:async(orderId)=>{
    await f.q("insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at,toss_order_id) values($1,$2,$3,'ready',null,'concurrent_checkout')",[id(102),id(1),id(20)]);
    return {orderId,status:'EXPIRED',totalAmount:20000};
  }});
  assert.equal((await api.post()).status,409);assert.equal((await api.order()).status,'canceled');assert.equal((await f.status()).used_at,null);assert.equal(api.rpcCalls(),2);
}));

test('block installed during provider lookup is rechecked before contact release', () => withDb(async f => {
  const api=await careCheckoutFixture(f,{provider:async(orderId)=>{
    await f.q('insert into dating_user_blocks values($1,$2)',[id(3),id(1)]);
    return {orderId,status:'EXPIRED',totalAmount:20000};
  }});
  const r=await api.post();assert.equal(r.status,409);assert.equal((await r.json()).code,'CARE_BLOCKED');
  assert.equal((await f.status()).used_at,null);assert.equal((await f.q('select contact_exchange_status s from dating_1on1_match_proposals where id=$1',[id(20)])).rows[0].s,'awaiting_applicant_payment');
}));

test('migration is repeatable, disabled, and does not alter existing records', () => withDb(async f => {
  const before = await f.q('select * from dating_1on1_match_proposals order by id');
  await f.db.exec(read('supabase/sql/contact_care.sql'));
  assert.deepEqual(await f.q('select * from dating_1on1_match_proposals order by id'), before);
  assert.equal((await f.q('select enabled from contact_care_policy')).rows[0].enabled,false);
  await assert.rejects(f.apply(), /CARE_INACTIVE/);
}));
test('server-only permissions: anon/auth cannot read or write claims, service cannot forge table grants', () => withDb(async f => {
  for (const role of ['anon','authenticated','service_role']) {
    await f.db.exec('set role '+role);
    if (role!=='service_role') {
      await assert.rejects(f.q('select * from contact_care_claims'), /permission denied/);
      await assert.rejects(f.apply(), /permission denied/);
      await assert.rejects(f.redeem(), /permission denied/);
      await assert.rejects(f.approve(id(70)), /permission denied/);
    }
    await assert.rejects(f.q("update contact_care_claims set status='approved'"), /permission denied/);
    await f.db.exec('reset role');
  }
}));
test('payer only, valid date, 24-hour wait, evidence, text length, no unlimited credits', () => withDb(async f => {
  await f.activate();
  await assert.rejects(f.apply([id(2)]), /CARE_PAYMENT/);
  await assert.rejects(f.apply([undefined,undefined,undefined,new Date().toISOString()]), /CARE_WAIT/);
  await assert.rejects(f.apply([undefined,undefined,undefined,new Date(Date.now()-10*86400000).toISOString()]), /CARE_WAIT/);
  await assert.rejects(f.apply([undefined,undefined,undefined,undefined,'짧음']), /CARE_INPUT/);
  const claim = await f.apply();
  assert.equal((await f.apply()).id, claim.id);
  await assert.rejects(f.approve(claim.id,[undefined,id(2)]), /CARE_ADMIN/);
  await assert.rejects(f.approve(claim.id,[undefined,undefined,undefined,false]), /CARE_EVIDENCE/);
  await f.approve(claim.id); await f.approve(claim.id);
  assert.equal((await f.q('select count(*)::int n from contact_care_claims')).rows[0].n,1);
  await assert.rejects(f.apply([undefined,id(20)]), /CARE_ONCE/);
}));
test('redemption atomically opens the correct match; retry does not spend twice; no payment insert or cancellation', () => withDb(async f => {
  await f.ready(); const before = await f.q('select * from toss_test_payment_orders');
  assert.equal((await f.redeem()).ok,true);
  const m = (await f.q('select * from dating_1on1_match_proposals where id=$1',[id(20)])).rows[0];
  assert.equal(m.contact_exchange_status,'approved'); assert.equal(m.contact_exchange_paid_by_user_id,id(1));
  assert.equal((await f.status()).used_match_id,id(20));
  assert.equal((await f.redeem()).alreadyUsed,true);
  await assert.rejects(f.redeem([undefined,id(10)]),/CARE_NO_CREDIT/);
  assert.deepEqual(await f.q('select * from toss_test_payment_orders'),before);
  await assert.rejects(f.q("insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at) values($1,$2,$3,'ready',null)",[id(200),id(3),id(20)]),/CARE_ALREADY_EXCHANGED/);
}));
test('pending/rejected cannot redeem; rejected is idempotent and cannot later approve silently', () => withDb(async f => {
  await f.activate(); const c = await f.apply();
  await assert.rejects(f.redeem(),/CARE_NO_CREDIT/);
  await f.approve(c.id,[undefined,undefined,false,false,'대화 이후 중단되어 대상이 아닙니다.']);
  await assert.rejects(f.redeem(),/CARE_NO_CREDIT/);
  await assert.rejects(f.approve(c.id),/CARE_REVIEWED/);
}));
test('stop new claims does not expire approved credits', () => withDb(async f => {
  await f.ready(); await f.db.exec('update contact_care_policy set enabled=false');
  assert.equal((await f.redeem()).ok,true);
}));
test('rejected requests can be corrected; old admin IDs are stale; approved credits cannot be reissued', () => withDb(async f => {
  await f.activate(); const old=await f.apply();
  await f.approve(old.id,[undefined,undefined,false,false,'증빙 내용을 더 확인해야 합니다.']);
  const next=await f.apply([undefined,undefined,undefined,undefined,'첫 연락 시각이 보이도록 증빙을 보완했습니다.']);
  assert.notEqual(next.id,old.id);assert.equal(next.status,'pending');
  assert.equal((await f.q('select count(*)::int n from contact_care_rejected_history')).rows[0].n,1);
  await assert.rejects(f.approve(old.id),/CARE_UNAVAILABLE/);
  await f.approve(next.id);assert.equal((await f.apply()).id,next.id);
  assert.equal((await f.status()).status,'approved');
}));
const failureCases = [
  ["update toss_test_payment_orders set status='canceled'",'CARE_PAYMENT'],
  ['update toss_test_payment_orders set cancel_amount=1','CARE_PAYMENT'],
  ["update profiles set is_banned=true where user_id='"+id(3)+"'",'CARE_UNAVAILABLE'],
  ["update auth.users set deleted_at=now() where id='"+id(3)+"'",'CARE_UNAVAILABLE'],
  ['update profiles set phone_verified=false','CARE_UNAVAILABLE'],
  ['update dating_1on1_cards set birth_year=2020','CARE_UNAVAILABLE'],
  ["update profiles set phone_e164='+821099999999'",'CARE_UNAVAILABLE'],
  ["update dating_1on1_cards set status='rejected'",'CARE_UNAVAILABLE'],
  ["update dating_1on1_match_proposals set state='candidate_rejected' where id='"+id(20)+"'",'CARE_MATCH_CHANGED'],
  ["update dating_1on1_match_proposals set contact_exchange_status='approved' where id='"+id(20)+"'",'CARE_MATCH_CHANGED'],
  [`insert into dating_user_blocks values('${id(3)}','${id(1)}')`,'CARE_BLOCKED'],
  [`insert into dating_1on1_admin_user_blocks values('${id(1)}','${id(3)}')`,'CARE_BLOCKED'],
  [`insert into dating_contact_blocks values('${id(1)}','phone','hash3')`,'CARE_BLOCKED'],
  [`insert into dating_1on1_phone_blocks values('${id(3)}','legacy1')`,'CARE_BLOCKED'],
  [`insert into dating_1on1_plus_subscriptions values('${id(1)}',now()+interval '1 day',true)`,'CARE_PLUS'],
  [`insert into app_purchase_events values('${id(3)}')`,'CARE_STORE'],
  [`insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at) values('${id(101)}','${id(3)}','${id(20)}','ready',null)`,'CARE_CHECKOUT'],
];
for (const [sql,code] of failureCases) test('redemption fails closed without spending: '+code+' / '+sql.slice(0,58), () => withDb(async f => {
  await f.ready(); await f.db.exec(sql);
  await assert.rejects(f.redeem(),new RegExp(code));
  assert.equal((await f.status()).used_at,null);
}));
test('DB update failure rolls back match opening AND credit spend', () => withDb(async f => {
  await f.ready();
  await f.db.exec("alter table contact_care_claims add constraint test_failure check(used_at is null)");
  await assert.rejects(f.redeem(), /test_failure/);
  assert.equal((await f.status()).used_at,null);
  assert.equal((await f.q('select contact_exchange_status s from dating_1on1_match_proposals where id=$1',[id(20)])).rows[0].s,'awaiting_applicant_payment');
}));
test('refund between request and approval cannot issue credit; nonmatching orders keep original behavior', () => withDb(async f => {
  await f.activate(); const c = await f.apply(); await f.db.exec('update toss_test_payment_orders set canceled_at=now()');
  await assert.rejects(f.approve(c.id),/CARE_PAYMENT/);
  assert.equal((await f.status()).status,'pending');
  await f.q('insert into toss_test_payment_orders(id,user_id,product_ref_id) values($1,$2,$3)',[id(300),id(2),id(20)]);
}));

test('exactly 24 hours is allowed; foreign match cannot use another credit', () => withDb(async f => {
  await f.activate(); await f.db.exec('begin');
  const t=(await f.q("select (now()-interval '24 hours')::text t")).rows[0].t;
  await f.apply([undefined,undefined,undefined,t]);await f.db.exec('commit');
  await f.approve((await f.status()).id);
  await assert.rejects(f.redeem([id(2)]),/CARE_NO_CREDIT/);
  await assert.rejects(f.redeem([undefined,id(10)]),/CARE_UNAVAILABLE/);
  await f.db.exec(`update dating_1on1_match_proposals set source_user_id='${id(2)}' where id='${id(20)}'`);
  await assert.rejects(f.redeem(),/CARE_UNAVAILABLE/);
  assert.equal((await f.status()).used_at,null);
}));

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require','module','exports',js)(n => n in mocks ? mocks[n] : n.startsWith('@/') ? load(n.slice(2)+'.ts',mocks) : require(n),mod,mod.exports);
  return mod.exports;
}
test('home, mypage and API all protect the full 72-hour claim window', () => {
  const now = Date.parse('2026-10-28T12:00:00Z'), hour = 3600000;
  for (const [file, constant, name] of [
    ['components/dating/OneOnOneHomePanel.tsx', 'ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS', 'canCancelOneOnOneMatchPreview'],
    ['app/mypage/page.tsx', 'ONE_ON_ONE_CONTACT_CANCEL_DELAY_MS', 'canCancelOneOnOneMatch'],
    ['app/api/dating/1on1/matches/[id]/route.ts', 'CONTACT_EXCHANGE_CANCEL_DELAY_MS', 'canCancelApprovedContactExchange'],
  ]) {
    const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const variable = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === constant));
    const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
    assert.ok(variable); assert.ok(fn);
    const js = ts.transpileModule(variable.getText(ast) + '\n' + fn.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const check = new Function('Date', js + `\nreturn ${name};`)({ parse: Date.parse, now: () => now });
    for (const [elapsed, allowed] of [[0,false], [48*hour,false], [71*hour,false], [72*hour-1,false], [72*hour,true], [73*hour,true]]) {
      const row = { state:'mutual_accepted', contact_exchange_status:'approved', contact_exchange_approved_at:new Date(now-elapsed).toISOString() };
      assert.equal(check(row, now), allowed, `${file}: ${elapsed}ms`);
    }
    for (const at of [null, '', 'invalid', new Date(now+hour).toISOString()]) {
      assert.equal(check({state:'mutual_accepted',contact_exchange_status:'approved',contact_exchange_approved_at:at},now),false);
    }
    assert.equal(check({state:'mutual_accepted',contact_exchange_status:'awaiting_applicant_payment'},now),true,'unpaid match cancellation unchanged');
    if (!file.includes('/api/')) {
      assert.equal(check({state:'admin_canceled',contact_exchange_status:'canceled'},now),false,'ended matches cannot cancel again');
      assert.equal(check({state:'source_selected',contact_exchange_status:'none'},now),false);
      assert.ok(read(file).split(`${name}(`).length >= 3, 'UI still calls the tested guard');
    }
  }
});

function cancellationApi(f, userId = id(1)) {
  let notifications = 0;
  const api = load('app/api/dating/1on1/matches/[id]/route.ts', {
    'next/server': { NextResponse: { json: (body,init) => Response.json(body,init) } },
    '@/lib/supabase/request': { getRequestAuthContext: async () => ({user:userId ? {id:userId} : null}) },
    '@/lib/supabase/server': { createAdminClient: () => client(f) },
    '@/lib/dating-1on1': {}, '@/lib/dating-email-templates': {}, '@/lib/dating-1on1-metrics': {},
    '@/lib/dating-blocks': {}, '@/lib/dating-contact-blocks': {}, '@/lib/dating-swipe': {},
    '@/lib/dating-1on1-sms': {}, '@/lib/dating-1on1-delivery-guard': {}, '@/lib/dating-1on1-age': {},
    '@/lib/dating-age': {},
    '@/lib/dating-notifications': { notifyDatingUser: async () => { notifications++; } },
  });
  return {
    post: (matchId=id(10), origin='https://local.invalid') => api.POST(new Request('https://local.invalid/api', {
      method:'POST', headers:{host:'local.invalid',origin,'content-type':'application/json'}, body:JSON.stringify({action:'cancel_mutual'}),
    }), {params:Promise.resolve({id:matchId})}),
    notifications: () => notifications,
  };
}

test('actual cancellation API and PostgreSQL enforce 72h for both parties without changing payment or exchange timestamps', t => withDb(async f => {
  const now = Date.parse('2026-10-28T12:00:00Z');
  t.mock.timers.enable({apis:['Date'],now});
  const paymentBefore = (await f.q('select * from toss_test_payment_orders')).rows;
  for (const user of [id(1),id(2)]) {
    const api = cancellationApi(f,user);
    for (const elapsed of [48*3600000, 72*3600000-1]) {
      await f.q("update dating_1on1_match_proposals set state='mutual_accepted',contact_exchange_status='approved',contact_exchange_approved_at=$1 where id=$2",[new Date(now-elapsed).toISOString(),id(10)]);
      const before = (await f.q('select * from dating_1on1_match_proposals where id=$1',[id(10)])).rows[0];
      const blocked = await api.post();
      assert.equal(blocked.status,409);const body=await blocked.json();
      assert.equal(body.code,'MATCH_CANCEL_NOT_READY');assert.match(body.error,/72시간/);
      assert.deepEqual((await f.q('select * from dating_1on1_match_proposals where id=$1',[id(10)])).rows[0],before);
      assert.equal(api.notifications(),0);
    }
    await f.q('update dating_1on1_match_proposals set contact_exchange_approved_at=$1 where id=$2',[new Date(now-72*3600000).toISOString(),id(10)]);
    const before = (await f.q('select * from dating_1on1_match_proposals where id=$1',[id(10)])).rows[0];
    assert.equal((await api.post()).status,200);
    const after = (await f.q('select * from dating_1on1_match_proposals where id=$1',[id(10)])).rows[0];
    assert.deepEqual(after,{...before,state:'admin_canceled',contact_exchange_status:'canceled',updated_at:new Date(now)});
    assert.equal((await api.post()).status,409,'duplicate cancellation rejected');assert.equal(api.notifications(),1);
  }
  assert.deepEqual((await f.q('select * from toss_test_payment_orders')).rows,paymentBefore);
}));

test('cancellation retains authorization, origin and unpaid-match behavior', () => withDb(async f => {
  assert.equal((await cancellationApi(f,null).post()).status,401);
  assert.equal((await cancellationApi(f,id(3)).post()).status,403);
  assert.equal((await cancellationApi(f).post(id(10),'https://evil.invalid')).status,403);
  assert.equal((await cancellationApi(f).post(id(999))).status,404);
  assert.equal((await cancellationApi(f).post(id(20))).status,200,'unpaid mutual match can still cancel immediately');
  await f.q('update dating_1on1_match_proposals set contact_exchange_approved_at=null where id=$1',[id(10)]);
  assert.equal((await cancellationApi(f).post()).status,409,'missing exchange timestamp fails closed');
}));

test('an already-canceled paid match remains claimable during 48-72h, including after the other profile is removed', () => withDb(async f => {
  await f.activate();
  await f.q("update dating_1on1_match_proposals set state='admin_canceled',contact_exchange_status='canceled',contact_exchange_approved_at=now()-interval '60 hours' where id=$1",[id(10)]);
  await f.q('delete from dating_1on1_cards where id=$1',[id(2)]);
  const member = load('app/api/dating/1on1/contact-care/route.ts', {
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:id(1)}})},
    '@/lib/supabase/server':{createAdminClient:()=>client(f)},
    '@/lib/dating-contact-blocks':{},'@/lib/dating-1on1-phone-blocks':{},
  });
  const response = await member.GET(new Request('https://local.invalid/api'));
  assert.equal(response.status,200);
  const body = await response.json();
  assert.equal(body.payments.length,1);assert.equal(body.payments[0].id,id(10));
  assert.equal(body.payments[0].name,'상대 프로필');
  assert.equal((await f.apply()).ok,true,'real SQL accepts a timely claim even when the match is canceled');
  assert.equal((await f.status()).status,'pending');
  assert.match(read('app/mypage/page.tsx'),/<ContactCarePanel key=\{summary\?\.profile.email \?\? "member"\} \/>/,'standalone claim entry stays outside individual cards');
}));

test('API guards: login, origin, malformed body, admin permissions; no DB before validation', async () => {
  let calls=0;
  const mocks={
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:null})},
    '@/lib/supabase/server':{createAdminClient:()=>{calls++;return {}}},
    '@/lib/admin-route':{requireAdminRoute:async()=>({ok:false,response:Response.json({}, {status:403})})},
    '@/lib/dating-contact-blocks':{},'@/lib/dating-1on1-phone-blocks':{},
  };
  const req = body => new Request('https://local.invalid/api',{method:'POST',headers:{host:'local.invalid',origin:'https://local.invalid','content-type':'application/json'},body});
  let member=load('app/api/dating/1on1/contact-care/route.ts',mocks);
  assert.equal((await member.GET(new Request('https://local.invalid/api'))).status,401);
  assert.equal((await member.POST(req('{}'))).status,401);
  assert.equal((await member.POST(new Request('https://local.invalid/api',{method:'POST',headers:{origin:'https://evil.invalid'},body:'{}'}))).status,403);
  const admin=load('app/api/admin/contact-care/route.ts',mocks);
  assert.equal((await admin.GET(new Request('https://local.invalid/api'))).status,403);
  assert.equal((await admin.POST(req('{}'))).status,403);
  mocks['@/lib/supabase/request']={getRequestAuthContext:async()=>({user:{id:id(1)}})};
  member=load('app/api/dating/1on1/contact-care/route.ts',mocks);
  for (const body of ['null','{','{}','{"matchId":"x"}','x'.repeat(4001)]) assert.equal((await member.POST(req(body))).status,400);
  assert.equal(calls,0);
});

// Small PostgREST adapter for this feature: real handlers -> real PostgreSQL SQL.
function client(f) {
  const tables=new Set(['contact_care_policy','contact_care_claims','contact_care_uploads','contact_care_manual_vouchers','profiles','toss_test_payment_orders','dating_1on1_match_proposals','dating_1on1_cards']);
  return {
    storage:{from(bucket){assert.equal(bucket,'contact-care-evidence');return {
      upload:async(name,bytes)=>{assert(Buffer.isBuffer(bytes));await f.q('insert into storage.objects values($1,$2)',[bucket,name]);return {error:null};},
      download:async(name)=>{const exists=(await f.q('select * from storage.objects where bucket_id=$1 and name=$2',[bucket,name])).rows.length;return exists?{data:new Blob(['webp-test']),error:null}:{error:Error('missing')};},
      remove:async(paths)=>{for(const name of paths)await f.q('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,name]);return {error:null};},
    };}},
    rpc: async (name,args)=>{try{return {data:await f.rpc(name,Object.values(args)),error:null};}catch(error){return {data:null,error};}},
    from(table){
      assert(tables.has(table));let fields='*',filters=[],values=[],orders=[],limit=100,single=false,head=false,updates=null;
      const column=v=>{assert.match(v,/^[a-z_][a-z0-9_]*$/);return v;};
      const bind=v=>{values.push(v);return '$'+values.length;};
      const b={
        update(v){updates=Object.entries(v).map(([k,val])=>`${column(k)}=${bind(val)}`).join(',');return b;},
        select(v,options){fields=v.split(',').map(column).join(',');head=options?.head===true;if(head)assert.equal(options.count,'exact');return b;},
        eq(k,v){filters.push(`${column(k)}=${bind(v)}`);return b;},
        gt(k,v){filters.push(`${column(k)}>${bind(v)}`);return b;},
        lt(k,v){filters.push(`${column(k)}<${bind(v)}`);return b;},
        gte(k,v){filters.push(`${column(k)}>=${bind(v)}`);return b;},
        is(k,v){assert.equal(v,null);filters.push(`${column(k)} is null`);return b;},
        not(k,operator,v){assert.equal(operator,'is');assert.equal(v,null);filters.push(`${column(k)} is not null`);return b;},
        in(k,v){filters.push(`${column(k)} in (${v.map(bind).join(',')})`);return b;},
        or(v){
          if(v==='cancel_amount.is.null,cancel_amount.eq.0')filters.push('(cancel_amount is null or cancel_amount=0)');
          else if(v==='status.eq.ready,status.eq.paid,payment_key.not.is.null,approved_at.not.is.null')filters.push("(status in ('ready','paid') or payment_key is not null or approved_at is not null)");
          else if(v.startsWith('created_at.gt.')) {
            const m=v.match(/^created_at.gt.([^,]+),and\(created_at.eq.([^,]+),id.gt.([\da-f-]+)\)$/);assert(m);assert.equal(m[1],m[2]);
            filters.push(`(created_at>${bind(m[1])} or (created_at=${bind(m[2])} and id>${bind(m[3])}))`);
          }
          else {const m=v.match(/^source_user_id.eq.([\da-f-]+),candidate_user_id.eq.([\da-f-]+)$/);assert(m);filters.push(`(source_user_id=${bind(m[1])} or candidate_user_id=${bind(m[2])})`);}
          return b;
        },
        order(k,o){orders.push(`${column(k)} ${o.ascending?'asc':'desc'}`);return b;},
        limit(n){assert(n<=100);limit=n;return b;},
        maybeSingle(){single=true;return b;},
        abortSignal(){return b;},
        then(yes,no){return f.q(updates ? `update ${table} set ${updates}${filters.length?' where '+filters.join(' and '):''} returning ${fields}` : `select ${head?'count(*)::int n':fields} from ${table}${filters.length?' where '+filters.join(' and '):''}${orders.length?' order by '+orders.join(','):''} limit ${limit}`,values)
          .then(r=>({data:head?null:JSON.parse(JSON.stringify(single?r.rows[0]||null:r.rows)),count:head?r.rows[0].n:null,error:null}),error=>({data:null,error})).then(yes,no);},
      };return b;
    },
  };
}
test('full API -> DB -> response story: member apply, admin review, member credit redemption, no payment/phone payload leakage', () => withDb(async f => {
  await f.activate();const db=client(f);
  // A valid exchange paid BEFORE launch must be listed and accepted, too.
  await f.db.exec("update contact_care_policy set starts_at=now()-interval '1 hour'");
  const mocks={
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:id(1)}})},
    '@/lib/supabase/server':{createAdminClient:()=>db},
    '@/lib/admin-route':{requireAdminRoute:async()=>({ok:true,admin:db,user:{id:id(4)}})},
    '@/lib/dating-contact-blocks':{normalizeDatingContactPhone:p=>p,hashDatingContactBlockValue:(_,p)=>p.endsWith('1111')?'hash1':'hash3'},
    '@/lib/dating-1on1-phone-blocks':{hashOneOnOneBlockedPhone:p=>p.endsWith('1111')?'legacy1':'legacy3'},
  };
  const member=load('app/api/dating/1on1/contact-care/route.ts',mocks),admin=load('app/api/admin/contact-care/route.ts',mocks);
  const req=(body)=>new Request('https://local.invalid/api',{method:'POST',headers:{host:'local.invalid',origin:'https://local.invalid','content-type':'application/json'},body:JSON.stringify(body)});
  const readMember=async()=>{const r=await member.GET(new Request('https://local.invalid/api'));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');const b=await r.json();assert(!JSON.stringify(b).includes('+8210'));return b;};
  let body=await readMember();assert.equal(body.payments.length,1);assert.equal(body.payments[0].name,'이전 상대');
  const application={action:'apply',matchId:id(10),orderId:id(100),firstContactAt:new Date(Date.now()-36*3600000).toISOString(),explanation:'카카오톡으로 첫 연락한 뒤 24시간이 지나도 첫 답장이 없습니다.',reason:'no_response',confirmed:true,userId:id(3)};
  const form=new FormData(); form.set('payload',JSON.stringify(application));form.append('evidence',new Blob([await require('sharp')({create:{width:20,height:30,channels:3,background:'white'}}).png().toBuffer()],{type:'image/png'}),'capture.png');
  const applied=await member.POST(new Request('https://local.invalid/api',{method:'POST',headers:{host:'local.invalid',origin:'https://local.invalid'},body:form}));
  assert.equal(applied.status,200,JSON.stringify(await applied.clone().json()));
  assert.equal((await f.status()).user_id,id(1),'body userId never controls owner');
  body=await readMember();assert.equal(body.claim.status,'pending');assert.deepEqual(body.payments,[]);
  const queue=await (await admin.GET(new Request('https://local.invalid/api'))).json();assert.equal(queue.items.length,1);
  assert.equal(queue.items[0].nickname,'검증회원');
  assert.equal((await admin.POST(req({claimId:body.claim.id,decision:'approved',evidenceChecked:false,note:'증빙을 아직 확인하지 않았습니다.'}))).status,400);
  assert.equal((await admin.POST(req({claimId:body.claim.id,decision:'approved',evidenceChecked:true,note:'무응답 증빙 확인으로 지급합니다.'}))).status,200);
  body=await readMember();assert.equal(body.claim.status,'approved');assert.equal(body.matches[0].name,'새 상대');
  assert.equal((await member.POST(req({action:'redeem',matchId:id(20),confirmed:true}))).status,200);
  body=await readMember();assert(body.claim.used_at);assert.deepEqual(body.matches,[]);
  assert.equal((await f.q('select count(*)::int n from toss_test_payment_orders')).rows[0].n,1);
}));

test('72-hour deadline is inclusive; expired applications cannot upload or submit', () => withDb(async f => {
  await f.activate();await f.db.exec('begin');
  await f.db.exec("update dating_1on1_match_proposals set contact_exchange_approved_at=now()-interval '72 hours' where contact_exchange_status='approved'");
  assert.equal((await f.apply()).ok,true);await f.db.exec('rollback');
  await f.db.exec("update dating_1on1_match_proposals set contact_exchange_approved_at=now()-interval '72 hours 1 second' where contact_exchange_status='approved'");
  await assert.rejects(f.upload(),/CARE_DEADLINE/);
}));

test('scam may apply immediately; no-response cannot; future contact dates rejected', () => withDb(async f => {
  await f.activate();const recent=new Date(Date.now()-1000).toISOString();
  await assert.rejects(f.apply([undefined,undefined,undefined,recent]),/CARE_WAIT/);
  await assert.rejects(f.apply([undefined,undefined,undefined,new Date(Date.now()+3600000).toISOString(),undefined,'scam']),/CARE_WAIT/);
  assert.equal((await f.apply([undefined,undefined,undefined,recent,undefined,'scam'])).ok,true);
}));

test('supplement retains timely application, rotates stale review ID, works after deadline and policy pause', () => withDb(async f => {
  await f.activate();const first=await f.apply();const created=(await f.status()).created_at;
  await f.approve(first.id,[undefined,undefined,'needs_info',false,'상대 식별과 날짜가 보이도록 첨부해 주세요.']);
  await f.db.exec("update contact_care_policy set enabled=false;update dating_1on1_match_proposals set contact_exchange_approved_at=now()-interval '5 days' where contact_exchange_status='approved'");
  const next=await f.apply();assert.notEqual(next.id,first.id);assert.deepEqual((await f.status()).created_at,created);
  await assert.rejects(f.approve(first.id),/CARE_UNAVAILABLE/);
  await f.approve(next.id);assert.equal((await f.status()).status,'approved');
  assert.equal((await f.rpc('cleanup_contact_care_uploads',[id(4)])).length,0,'recently superseded evidence is retained for review audit');
}));

test('expired supplement cannot submit; submitted application is not rejected merely because time passed', () => withDb(async f => {
  await f.activate();const c=await f.apply();await f.approve(c.id,[undefined,undefined,'needs_info',false,'추가 캡처가 필요합니다.']);
  await f.db.exec("update contact_care_claims set supplement_due_at=now()-interval '1 second'");
  await assert.rejects(f.apply(),/CARE_SUPPLEMENT/);
  // Admin may finish a case even if the user never supplies more material.
  assert.equal((await f.approve(c.id,[undefined,undefined,false,false,'추가 자료가 제출되지 않아 반려합니다.'])).ok,true);
  assert.equal((await f.status()).status,'rejected');
}));

test('evidence cannot be forged, reused from another payer, incomplete or under cleanup; reservation rate bounded', () => withDb(async f => {
  await f.activate();const u=await f.upload();const first=new Date(Date.now()-36*3600000).toISOString();
  const submit=()=>f.rpc('submit_contact_care',[id(1),id(10),id(100),first,'연락 시각이 포함된 무응답 대화 캡처입니다.','no_response',u.id,null]);
  await f.q('update contact_care_uploads set user_id=$1 where id=$2',[id(2),u.id]);await assert.rejects(submit(),/CARE_UPLOAD/);
  await f.q('update contact_care_uploads set user_id=$1,purging=true where id=$2',[id(1),u.id]);await assert.rejects(submit(),/CARE_UPLOAD/);
  await f.q('update contact_care_uploads set purging=false where id=$1',[u.id]);await f.db.exec('delete from storage.objects');await assert.rejects(submit(),/CARE_UPLOAD/);
  for(let i=0;i<4;i++)await f.upload();await assert.rejects(f.upload(),/CARE_RATE/);
  assert.equal((await f.q('select count(*)::int n from contact_care_claims')).rows[0].n,0);
}));

test('private bucket denies public read/write even with permissive unrelated storage policies', () => withDb(async f => {
  await f.activate();await f.upload();
  for(const role of ['anon','authenticated']){
    await f.db.exec('set role '+role);
    assert.equal((await f.q('select * from storage.objects')).rows.length,0);
    await assert.rejects(f.q("insert into storage.objects values('contact-care-evidence','fake.webp')"),/row-level security/);
    await f.db.exec('reset role');
  }
  assert.equal((await f.q("select public from storage.buckets where id='contact-care-evidence'")).rows[0].public,false);
}));

test('cleanup removes only expired evidence, preserves pending/credit/match records and is retry-safe', () => withDb(async f => {
  await f.activate();const orphan=await f.upload();await f.q("update contact_care_uploads set created_at=now()-interval '25 hours' where id=$1",[orphan.id]);
  const c=await f.apply();await f.db.exec("update contact_care_uploads set created_at=now()-interval '31 days' where submitted_at is not null");
  let staged=await f.rpc('cleanup_contact_care_uploads',[id(4)]);assert.equal(staged.length,1);assert.equal(staged[0].id,orphan.id);
  await f.rpc('finish_contact_care_cleanup',[id(4),orphan.id]);assert.equal((await f.q('select id from contact_care_uploads where id=$1',[orphan.id])).rows.length,1,'storage must be deleted first');
  await client(f).storage.from('contact-care-evidence').remove(orphan.paths);await f.rpc('finish_contact_care_cleanup',[id(4),orphan.id]);
  await f.approve(c.id);await f.db.exec("update contact_care_claims set reviewed_at=now()-interval '31 days'");
  staged=await f.rpc('cleanup_contact_care_uploads',[id(4)]);assert.equal(staged.length,1);
  await client(f).storage.from('contact-care-evidence').remove(staged[0].paths);await f.rpc('finish_contact_care_cleanup',[id(4),staged[0].id]);
  assert.equal((await f.status()).status,'approved');assert.equal((await f.redeem()).ok,true);
  assert.equal((await f.rpc('cleanup_contact_care_uploads',[id(4)])).length,0);
}));

test('evidence API enforces owner/admin auth, index bounds, no-store and closed-case retention', () => withDb(async f => {
  await f.activate();const c=await f.apply();let user=id(1),isAdmin=false;
  const db=client(f),mocks={
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:user?{id:user}:null})},
    '@/lib/supabase/server':{createAdminClient:()=>db},
    '@/lib/admin-route':{requireAdminRoute:async()=>({ok:isAdmin})},
  };
  const api=load('app/api/dating/1on1/contact-care/evidence/route.ts',mocks);
  const request=(index='0')=>new Request(`https://local.invalid/api?claimId=${c.id}&index=${index}`);
  let r=await api.GET(request());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
  user=id(2);assert.equal((await api.GET(request())).status,403);
  isAdmin=true;assert.equal((await api.GET(request())).status,200);
  user=null;assert.equal((await api.GET(request())).status,401);
  user=id(1);assert.equal((await api.GET(request('../0'))).status,400);
  await f.approve(c.id);await f.db.exec("update contact_care_claims set reviewed_at=now()-interval '31 days'");
  assert.equal((await api.GET(request())).status,410);
}));

test('image processing strips metadata, preserves aspect ratio and rejects fake/oversized uploads', async()=>{
  const helpers=load('lib/contact-care-evidence.ts');const sharp=require('sharp');
  const original=await sharp({create:{width:800,height:2400,channels:3,background:'white'}}).withMetadata({orientation:1}).png().toBuffer();
  const form=new FormData();form.append('evidence',new Blob([original],{type:'image/png'}),'conversation.png');
  const [bytes]=await helpers.prepareCareEvidence(form);const meta=await sharp(bytes).metadata();
  assert.equal(meta.format,'webp');assert.equal(meta.width/meta.height,1/3);assert.equal(meta.exif,undefined);
  const fake=new FormData();fake.append('evidence',new Blob(['<svg><script>alert(1)</script></svg>'],{type:'image/png'}),'fake.png');
  await assert.rejects(helpers.prepareCareEvidence(fake));
  const huge=new Request('https://local.invalid',{method:'POST',body:'x'.repeat(3500001)});await assert.rejects(helpers.readCareForm(huge),/CARE_UPLOAD/);
});

test('a timely claim survives original-match deletion; its credit still checks the original payment', () => withDb(async f => {
  await f.activate(); const c=await f.apply();
  assert.equal((await f.status()).counterparty_name,'이전 상대');
  assert.ok((await f.status()).exchanged_at);
  await f.q('delete from dating_1on1_match_proposals where id=$1',[id(10)]);
  await f.approve(c.id);
  await f.db.exec('update toss_test_payment_orders set cancel_amount=20000');
  await assert.rejects(f.redeem(),/CARE_PAYMENT/);
  assert.equal((await f.status()).used_at,null);
  await f.db.exec('update toss_test_payment_orders set cancel_amount=0');
  assert.equal((await f.redeem()).ok,true);
}));

test('supplement after original-match deletion uses the verified snapshot, not a client-supplied date', () => withDb(async f => {
  await f.activate();const c=await f.apply();
  await f.approve(c.id,[undefined,undefined,'needs_info',false,'날짜가 보이는 캡처를 첨부해 주세요.']);
  await f.q('delete from dating_1on1_match_proposals where id=$1',[id(10)]);
  await f.db.exec("update contact_care_policy set enabled=false,starts_at=now()-interval '1 hour'");
  for(let n=0;n<51;n++) await f.q('insert into toss_test_payment_orders(id,user_id,product_ref_id,approved_at) values($1,$2,$3,now())',[id(700+n),id(1),id(800+n)]);
  const db=client(f),mocks={
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:id(1)}})},
    '@/lib/supabase/server':{createAdminClient:()=>db},
    '@/lib/dating-contact-blocks':{},'@/lib/dating-1on1-phone-blocks':{},
  };
  const member=load('app/api/dating/1on1/contact-care/route.ts',mocks);
  const status=await (await member.GET(new Request('https://local.invalid'))).json();
  assert.equal(status.payments.length,1);assert.equal(status.payments[0].name,'이전 상대');
  await assert.rejects(f.apply([undefined,undefined,undefined,new Date(Date.now()-3*86400000).toISOString()]),/CARE_WAIT/);
  const next=await f.apply();await f.approve(next.id);assert.equal((await f.redeem()).ok,true);
}));

test('activation validates grants and is repeatable without resetting the 48-hour start', () => withDb(async f => {
  const activate=read('supabase/sql/contact_care_activate.sql');
  await f.db.exec(activate);
  const first=(await f.q('select * from contact_care_policy')).rows[0];
  assert.equal(first.enabled,true);assert.ok(first.starts_at);
  await f.db.exec(activate);assert.deepEqual((await f.q('select * from contact_care_policy')).rows[0],first);
  await f.db.exec('grant select on contact_care_claims to authenticated');
  await assert.rejects(f.db.exec(activate),/Unsafe contact-care grants/);
  await f.db.exec('rollback');
}));

test('public notice fails closed before installation, expires 48h from activation and has no member data or mail', async()=>{
  const notice=load('lib/contact-care-notice.ts'),start=Date.parse('2026-10-18T00:00:00Z');
  const p=notice.contactCarePublicPolicy(true,new Date(start).toISOString(),start);
  assert.equal(notice.isContactCareNoticeActive(p,start),true);
  assert.equal(notice.isContactCareNoticeActive(p,start+48*3600000-1),true);
  assert.equal(notice.isContactCareNoticeActive(p,start+48*3600000),false);
  for(const value of [null,'invalid','2030-01-01'])assert.equal(notice.contactCarePublicPolicy(true,value,start).active,false);
  assert.equal(notice.contactCarePublicPolicy(false,new Date(start).toISOString(),start).active,false);
  for(const path of ['/login','/signup','/payments/success','/dating/card/new','/mypage/admin','/phone-verification'])assert.equal(notice.contactCareNoticePathAllowed(path),false);
  for(const path of ['/landing','/mypage','/community/dating/cards','/tools'])assert.equal(notice.contactCareNoticePathAllowed(path),true);
  assert.match(notice.CONTACT_CARE_NOTICE_MESSAGE,/관리자가 확인 후 지원 대상에 해당하면/);
  assert.match(notice.CONTACT_CARE_NOTICE_MESSAGE,/1:1 번호교환권 1장/);
  assert.doesNotMatch(notice.CONTACT_CARE_NOTICE_MESSAGE,/지원권|메일|\uFFFD/);
  let fields;
  const query={select(v){fields=v;return this;},eq(){return this;},abortSignal(){return this;},maybeSingle(){return Promise.resolve({error:{code:'42P01'}});}};
  const api=load('app/api/dating/1on1/contact-care/policy/route.ts',{'@/lib/supabase/server':{createAdminClient:()=>({from(name){assert.equal(name,'contact_care_policy');return query;}})}});
  const response=await api.GET();assert.equal(response.status,200);assert.deepEqual(await response.json(),{active:false,startsAt:null,endsAt:null});assert.equal(fields,'enabled,starts_at');
});

test('admin queue is oldest first and paginates without gaps at identical timestamps',()=>withDb(async f=>{
  await f.activate();await f.apply();
  for(let i=5;i<29;i++){
    await f.q('insert into auth.users(id) values($1)',[id(i)]);
    await f.q(`insert into contact_care_claims(user_id,match_id,order_id,first_contact_at,explanation,reason,upload_id,evidence_count,created_at)
      values($1,$2,$3,now(),'페이지 정렬을 검증하는 신청입니다.','no_response',$4,1,'2026-01-01T00:00:00.123456Z')`,[id(i),id(1000+i),id(2000+i),id(3000+i)]);
  }
  const db=client(f),api=load('app/api/admin/contact-care/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/admin-route':{requireAdminRoute:async()=>({ok:true,admin:db,user:{id:id(4)}})},
  });
  // PGlite's JS Date truncates microseconds; preserve the actual wire timestamp in this adapter fixture.
  await f.db.exec("update contact_care_claims set created_at=date_trunc('milliseconds',created_at)");
  const a=await (await api.GET(new Request('https://local.invalid'))).json();assert.equal(a.items.length,20);assert(a.next);
  const b=await (await api.GET(new Request('https://local.invalid?before='+encodeURIComponent(a.next)))).json();assert.equal(b.items.length,5);assert.equal(b.next,null);
  assert.equal(new Set([...a.items,...b.items].map(i=>i.id)).size,25);
  assert.equal(b.items.at(-1).user_id,id(1));
  const helper=load('lib/contact-care-server.ts',{'next/server':{NextResponse:{json:Response.json}}});
  assert.equal(helper.parseCareCursor('2026-01-01T00:00:00.123456+00:00|'+id(1)).at,'2026-01-01T00:00:00.123456+00:00');
  assert.equal((await api.GET(new Request('https://local.invalid?before=bad,or(id.gt.x)'))).status,400);
}));

test('bounded JSON reader rejects oversized bodies even without Content-Length', async()=>{
  const {readCareJson}=load('lib/contact-care-server.ts',{'next/server':{NextResponse:{json:Response.json}}});
  await assert.rejects(readCareJson(new Request('https://local.invalid',{method:'POST',body:'x'.repeat(4001)}),4000),/CARE_INPUT/);
  assert.deepEqual(await readCareJson(new Request('https://local.invalid',{method:'POST',body:'{"note":"한글 정상"}'}),4000),{note:'한글 정상'});
});

test('narrow migration upgrades legacy eligibility, preserves all rows/grants and matches fresh install',()=>withDb(async f=>{
  const definition=read('supabase/sql/contact_care.sql').replace(/\r\n/g,'\n').match(/create or replace function public\.check_contact_care_application[\s\S]*?\$\$;/)[0];
  const legacy=definition.replace('from public.contact_care_policy p\n','from public.contact_care_policy p join public.toss_test_payment_orders o on o.id=p_order\n')
    .replace('p.starts_at<=now())','p.starts_at<=now() and o.approved_at>=p.starts_at)');
  assert.notEqual(legacy,definition);await f.db.exec(legacy);
  await f.activate();await f.db.exec("update contact_care_policy set starts_at=now()-interval '1 hour'");
  await assert.rejects(f.upload(),/CARE_INACTIVE/);
  const snapshot=async()=>{
    const out={};for(const table of ['contact_care_policy','contact_care_claims','contact_care_uploads','toss_test_payment_orders','dating_1on1_match_proposals']) out[table]=await f.q(`select * from ${table} order by id`);
    out.grants=await f.q("select proowner,proacl from pg_proc where oid='public.check_contact_care_application(uuid,uuid,uuid)'::regprocedure");return out;
  };
  const before=await snapshot();
  for(let i=0;i<2;i++)await f.db.exec(read('supabase/sql/contact_care_recent_exchanges.sql'));
  assert.deepEqual(await snapshot(),before);
  const upgraded=await f.q("select pg_get_functiondef('public.check_contact_care_application(uuid,uuid,uuid)'::regprocedure) definition");
  await f.db.exec(definition);
  assert.deepEqual(await f.q("select pg_get_functiondef('public.check_contact_care_application(uuid,uuid,uuid)'::regprocedure) definition"),upgraded);
  assert.equal((await f.apply()).ok,true);assert.equal((await f.status()).status,'pending');
}));

for(const [sql,code] of [
  ["update contact_care_policy set enabled=false",'CARE_INACTIVE'],
  ["update contact_care_policy set starts_at=now()+interval '1 hour'",'CARE_INACTIVE'],
  ["update contact_care_policy set enabled=false,starts_at=null",'CARE_INACTIVE'],
  ["update toss_test_payment_orders set amount=0",'CARE_PAYMENT'],
  ["update toss_test_payment_orders set approved_at=null",'CARE_PAYMENT'],
  ["update toss_test_payment_orders set cancel_amount=1",'CARE_PAYMENT'],
  ["update toss_test_payment_orders set canceled_at=now()",'CARE_PAYMENT'],
  ["update toss_test_payment_orders set user_id='"+id(2)+"'",'CARE_PAYMENT'],
  ["update dating_1on1_match_proposals set contact_exchange_approved_at=now()-interval '73 hours' where id='"+id(10)+"'",'CARE_DEADLINE'],
]) test('pre-launch exchange still enforces '+code+' / '+sql,()=>withDb(async f=>{
  await f.activate();await f.db.exec("update contact_care_policy set starts_at=now()-interval '1 hour'");
  await f.db.exec(sql);await assert.rejects(f.upload(),new RegExp(code));
  assert.equal((await f.q('select count(*)::int n from contact_care_uploads')).rows[0].n,0);
  assert.equal((await f.q('select count(*)::int n from contact_care_claims')).rows[0].n,0);
}));

test('application guidance matches 24h/72h boundaries, supplement, inputs and scam exception',()=>{
  const {contactCareApplicationIssue:issue}=load('lib/contact-care.ts');
  const now=Date.parse('2026-10-18T12:00:00Z'),hour=3600000;
  const value={selected:{id:id(10),name:'검증',exchanged_at:new Date(now-48*hour).toISOString()},first:new Date(now-24*hour).toISOString(),reason:'no_response',explanation:'연락 후 첫 답장이 오지 않았습니다.',evidenceCount:1,confirmed:true,stale:false,now};
  assert.equal(issue(value),null);
  for(const [change,pattern] of [
    [{stale:true},/내역 다시 확인/],[{selected:undefined},/결제 건/],
    [{first:''},/날짜와 시간/],[{first:'bad'},/날짜와 시간/],
    [{first:new Date(now+hour).toISOString()},/미래/],
    [{first:new Date(now-49*hour).toISOString()},/번호교환 이후/],
    [{first:new Date(now-24*hour+1).toISOString()},/24시간부터/],
    [{first:new Date(now+hour).toISOString(),now:now+24*hour},/기한이 지나요/],
    [{explanation:'짧음'},/10자/],[{explanation:'가'.repeat(501)},/500자/],
    [{evidenceCount:0},/캡처/],[{evidenceCount:4},/캡처/],[{confirmed:false},/체크/],
    [{now:now+24*hour+1},/72시간/],
    [{supplement:{dueAt:null}},/추가 자료 제출 기간/],
    [{supplement:{dueAt:new Date(now-1).toISOString()}},/추가 자료 제출 기간/],
  ]) assert.match(issue({...value,...change}),pattern,JSON.stringify(change));
  assert.equal(issue({...value,now:now+24*hour}),null,'72h inclusive');
  assert.equal(issue({...value,reason:'scam',first:new Date(now).toISOString()}),null);
  assert.equal(issue({...value,now:now+48*hour,supplement:{dueAt:new Date(now+48*hour).toISOString()}}),null);
});

const grantManual = (f, count=3, user=id(1)) => f.q(`insert into contact_care_manual_vouchers(user_id,grant_reference,grant_index,reason)
  select $1::uuid,'offline-operator-grant-'||($1::uuid)::text,n,'운영자 요청에 따른 추가 교환권 지급' from generate_series(1,$2::int) n
  on conflict(grant_reference,grant_index) do nothing`,[user,count]);
const manualRedeem = (f, overrides=[]) => f.rpc('redeem_contact_care_manual',[id(1),id(20),['+821011111111','+821033333333'],['hash1','hash3'],['legacy1','legacy3']].map((v,i)=>overrides[i]===undefined?v:overrides[i]));
const manualRemaining = async f => (await f.q('select count(*)::int n from contact_care_manual_vouchers where used_at is null and revoked_at is null')).rows[0].n;
const addManualMatch = (f,n) => f.q('insert into dating_1on1_match_proposals(id,source_user_id,candidate_user_id,source_card_id,candidate_card_id) values($1,$2,$3,$2,$3)',[id(n),id(1),id(3)]);

test('manual migration is additive and repeatable; grant retries preserve existing claim and payments',()=>withDb(async f=>{
  await f.ready();const claim=await f.status(),payments=await f.q('select * from toss_test_payment_orders'),matches=await f.q('select * from dating_1on1_match_proposals order by id');
  const legacy=(await f.q("select pg_get_functiondef('redeem_contact_care(uuid,uuid,text[],text[],text[])'::regprocedure) d")).rows[0].d;
  await f.db.exec(read('supabase/sql/contact_care_manual_vouchers.sql'));
  await grantManual(f);await grantManual(f);
  assert.equal(await manualRemaining(f),3);assert.deepEqual(await f.status(),claim);
  assert.deepEqual(await f.q('select * from toss_test_payment_orders'),payments);
  assert.deepEqual(await f.q('select * from dating_1on1_match_proposals order by id'),matches);
  assert.equal((await f.q("select pg_get_functiondef('redeem_contact_care(uuid,uuid,text[],text[],text[])'::regprocedure) d")).rows[0].d,legacy);
}));

test('manual vouchers: 3 -> 2 -> 1 -> 0, retries do not spend, old claim still redeemable',()=>withDb(async f=>{
  await f.ready();await grantManual(f);const claim=await f.status();
  const payments=await f.q('select * from toss_test_payment_orders');
  await addManualMatch(f,21);await addManualMatch(f,22);await addManualMatch(f,23);
  for(const n of [20,21,22]) {
    assert.equal((await manualRedeem(f,[undefined,id(n)])).alreadyUsed,false);
    assert.equal((await manualRedeem(f,[undefined,id(n)])).alreadyUsed,true);
    assert.equal(await manualRemaining(f),22-n);
    assert.deepEqual(await f.status(),claim);
  }
  await grantManual(f);assert.equal(await manualRemaining(f),0,'retrying the original grant after use must not restore spent vouchers');
  await assert.rejects(manualRedeem(f,[undefined,id(23)]),/CARE_NO_CREDIT/);
  assert.equal((await f.redeem([undefined,id(23)])).ok,true);
  assert.deepEqual(await f.q('select * from toss_test_payment_orders'),payments);
  await assert.rejects(f.q("insert into toss_test_payment_orders(id,user_id,product_ref_id,status,approved_at) values($1,$2,$3,'ready',null)",[id(201),id(3),id(20)]),/CARE_ALREADY_EXCHANGED/);
  await assert.rejects(f.upload(id(1),id(20),id(201)),/CARE_ONCE|CARE_PAYMENT/,'voucher exchange cannot generate another compensation');
  await f.q("update dating_1on1_match_proposals set state='candidate_rejected' where id=$1",[id(20)]);
  assert.equal((await manualRedeem(f)).alreadyUsed,true);
  assert.equal((await f.q('select state from dating_1on1_match_proposals where id=$1',[id(20)])).rows[0].state,'candidate_rejected','retry must not reopen a closed match');
}));

test('manual vouchers have no issuance/write access for browser OR service roles',()=>withDb(async f=>{
  await grantManual(f);
  for(const role of ['anon','authenticated','service_role']) {
    await f.db.exec('set role '+role);
    if(role!=='service_role') {
      await assert.rejects(f.q('select * from contact_care_manual_vouchers'),/permission denied/);
      await assert.rejects(manualRedeem(f),/permission denied/);
    }
    await assert.rejects(grantManual(f),/permission denied/);
    await assert.rejects(f.q('update contact_care_manual_vouchers set used_at=null'),/permission denied/);
    await assert.rejects(f.q('delete from contact_care_manual_vouchers'),/permission denied/);
    await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');assert.equal((await manualRedeem(f)).ok,true);await f.db.exec('reset role');
}));

for(const [sql,code] of failureCases.filter(([,code])=>code!=='CARE_PAYMENT')) test('manual redemption fails closed without spending: '+code+' / '+sql.slice(0,58),()=>withDb(async f=>{
  await grantManual(f);await f.db.exec(sql);
  await assert.rejects(manualRedeem(f),new RegExp(code));assert.equal(await manualRemaining(f),3);
}));

test('manual redemption rejects revoked/no credit, foreign ownership, forged phones and invalid IDs',()=>withDb(async f=>{
  await assert.rejects(manualRedeem(f),/CARE_NO_CREDIT/);
  await grantManual(f);
  await assert.rejects(manualRedeem(f,[null]),/CARE_INPUT/);
  await assert.rejects(manualRedeem(f,[undefined,null]),/CARE_INPUT/);
  await assert.rejects(manualRedeem(f,[id(2)]),/CARE_NO_CREDIT/);
  await assert.rejects(manualRedeem(f,[undefined,undefined,['+821011111111']]),/CARE_UNAVAILABLE/);
  await assert.rejects(manualRedeem(f,[undefined,undefined,null]),/CARE_UNAVAILABLE/);
  await f.q('update dating_1on1_match_proposals set source_user_id=$1 where id=$2',[id(2),id(20)]);
  await assert.rejects(manualRedeem(f),/CARE_UNAVAILABLE/);
  await f.db.exec('update contact_care_manual_vouchers set revoked_at=now()');
  await assert.rejects(manualRedeem(f),/CARE_NO_CREDIT/);
}));

test('manual DB failure rolls back BOTH voucher use and number exchange; queued double click spends once',()=>withDb(async f=>{
  await grantManual(f);await f.db.exec('alter table contact_care_manual_vouchers add constraint offline_spend_failure check(used_at is null)');
  await assert.rejects(manualRedeem(f),/offline_spend_failure/);assert.equal(await manualRemaining(f),3);
  assert.equal((await f.q('select contact_exchange_status s from dating_1on1_match_proposals where id=$1',[id(20)])).rows[0].s,'awaiting_applicant_payment');
  await f.db.exec('alter table contact_care_manual_vouchers drop constraint offline_spend_failure');
  const responses=await Promise.all([manualRedeem(f),manualRedeem(f)]);
  assert.deepEqual(responses.map(r=>r.alreadyUsed),[false,true]);assert.equal(await manualRemaining(f),2);
  assert.match(read('supabase/sql/contact_care_manual_vouchers.sql'),/pg_advisory_xact_lock\(hashtextextended\(p_match::text,15000\)\)/);
  assert.match(read('supabase/sql/contact_care_manual_vouchers.sql'),/pg_advisory_xact_lock\(hashtextextended\(p_user::text,17003\)\)/);
}));

test('manual API -> DB -> balance/history, authenticated owner only and unchanged legacy claim',()=>withDb(async f=>{
  await f.ready();await grantManual(f);const claim=await f.status();const db=client(f);
  const mocks={
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/request':{getRequestAuthContext:async()=>({user:{id:id(1)}})},
    '@/lib/supabase/server':{createAdminClient:()=>db},
    '@/lib/dating-contact-blocks':{normalizeDatingContactPhone:p=>p,hashDatingContactBlockValue:(_,p)=>p.endsWith('1111')?'hash1':'hash3'},
    '@/lib/dating-1on1-phone-blocks':{hashOneOnOneBlockedPhone:p=>p.endsWith('1111')?'legacy1':'legacy3'},
  };
  const api=load('app/api/dating/1on1/contact-care/route.ts',mocks);
  const readMember=async(query='')=>{const response=await api.GET(new Request('https://local.invalid/api'+query));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');return response.json();};
  assert.deepEqual(await readMember('?summary=1'),{remaining:4});
  let body=await readMember();assert.equal(body.manual_remaining,3);assert.equal(body.matches.length,1);
  const response=await api.POST(new Request('https://local.invalid/api',{method:'POST',headers:{host:'local.invalid',origin:'https://local.invalid','content-type':'application/json'},body:JSON.stringify({action:'redeem_manual',matchId:id(20),confirmed:true,userId:id(2),quantity:99})}));
  assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assert.deepEqual(await readMember('?summary=1'),{remaining:3});
  body=await readMember();assert.equal(body.manual_remaining,2);assert.equal(body.manual_history[0].used_match_id,id(20));
  assert(!JSON.stringify(body).includes('+8210'));assert(!JSON.stringify(body).includes('운영자 요청'));assert.deepEqual(await f.status(),claim);
  await f.db.exec('drop table contact_care_manual_vouchers cascade');
  assert.deepEqual(await readMember('?summary=1'),{remaining:1},'missing additive migration leaves legacy claim functional');
}));
