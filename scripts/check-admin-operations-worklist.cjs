/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { getOrigin, run } = require('./check-operations-smoke.cjs');
const ref = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const root = path.resolve(__dirname, '..');
const read = file => readFileSync(path.join(root,file), 'utf8');
function load(file, dependencies) {
  const { outputText } = ts.transpileModule(read(file), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const exports = {};
  vm.runInNewContext(outputText, {
    exports, require: id => { assert.ok(Object.hasOwn(dependencies,id), id); return dependencies[id]; },
    AbortSignal, Date, Promise,
  }, { filename: file });
  return exports;
}
function database(results) {
  const calls = [];
  const admin = { from(table) {
    const call = {table, ops:[]}; calls.push(call);
    const q = { then(ok, fail) {
      const callbacks = results[table];
      const value = Array.isArray(callbacks) ? callbacks.shift() : callbacks;
      return Promise.resolve(value ?? {count:0,error:null}).then(ok, fail);
    }};
    for (const method of ['select','eq','gte','lt','is','in','or','order','limit','abortSignal','update']) q[method] = (...args) => {
      call.ops.push([method,...args]);
      return q;
    };
    return q;
  }};
  return {admin,calls};
}
function getRoute(auth) {
  return load('app/api/admin/operations/route.ts', {
    'next/server':{NextResponse:{json:(body, init={})=>Response.json(body,init)}},
    '@/lib/admin-route':{requireAdminRoute:async()=>auth},
  }).GET;
}
test('worklist rejects guest and non-admin before any query and never caches', async () => {
  for (const status of [401,403]) {
    const {admin,calls}=database({});
    const r=await getRoute({ok:false,response:{status},admin})();
    assert.equal(r.status,status);
    assert.equal(calls.length,0);
    assert.match(r.headers.get('cache-control'),/private, no-store/);
  }
});
test('worklist counts only accepted participant payment reviews; does not expose record details or treat an unavailable count as zero', async () => {
  const {admin,calls}=database({
    toss_test_payment_orders:[
      {data:[
        {match_hint:ref(1),user_id:ref(7)},
        {product_ref_id:ref(1),user_id:ref(8)},
        {match_hint:ref(2),user_id:ref(9)},
        {match_hint:ref(3),user_id:ref(10)},
        {match_hint:ref(4),user_id:ref(7)},
        {match_hint:ref(5),user_id:ref(7)},
      ]},
      {count:6,error:null},
    ],
    dating_1on1_match_proposals:{data:[
      {id:ref(1),source_user_id:ref(7),candidate_user_id:ref(8),state:'mutual_accepted',contact_exchange_status:'none'},
      {id:ref(2),source_user_id:ref(7),candidate_user_id:ref(8),state:'mutual_accepted',contact_exchange_status:'none'},
      {id:ref(3),source_user_id:ref(10),candidate_user_id:ref(8),state:'mutual_accepted',contact_exchange_status:'approved'},
      {id:ref(4),source_user_id:ref(7),candidate_user_id:ref(8),state:'canceled',contact_exchange_status:'none'},
      {id:ref(5),source_user_id:ref(7),candidate_user_id:ref(8),state:'mutual_accepted',contact_exchange_status:'canceled'},
    ]},
    dating_profile_review_jobs:{count:null,error:{message:'fixture private error'}},
    contact_care_claims:{count:2,error:null},
  });
  const r=await getRoute({ok:true,admin})();
  const body=await r.text();
  assert.ok(!body.includes(ref(1)) && !body.includes('fixture private error'));
  assert.deepEqual(JSON.parse(body).counts,{
    paymentReview:1,agedCheckout:6,checkoutHelp:0,vouchers:2,profileReview:null,datingReports:0,support:0,
  });
  assert.ok(calls.every(({ops})=>ops.every(([op])=>op!=='update')));
  const aged=calls.find(({table,ops})=>table==='toss_test_payment_orders'&&ops.some(([,key,v])=>key==='status'&&v==='ready'));
  assert.ok(aged.ops.some(([op,key])=>op==='lt'&&key==='created_at'));
});
test('bounded payment review refuses to turn a partial page into a complete count', async () => {
  const {admin,calls}=database({toss_test_payment_orders:[{data:Array(201).fill({})},{count:0}]});
  const r=await getRoute({ok:true,admin})(); assert.equal((await r.json()).counts.paymentReview,null);
  assert.ok(!calls.some(x=>x.table==='dating_1on1_match_proposals'));
});
test('both ban entrypoints share visibility cleanup, which reports partial failure and never edits matches or payments', async () => {
  const {admin,calls}=database({dating_cards:{data:[{sex:'male'}]},dating_paid_cards:{error:{code:'fixture'}},dating_1on1_cards:{data:[{id:ref(1)}]}});
  const promoted=[];
  const {hideBannedMemberDatingCards}=load('lib/admin-ban-visibility.ts',{
    '@/lib/dating-cards-queue':{promotePendingCardsBySex:async(_,sex)=>{promoted.push(sex);}},
  });
  const state=await hideBannedMemberDatingCards(admin,ref(7),'2026-11-27T00:00:00Z');
  assert.deepEqual(JSON.parse(JSON.stringify(state)),{hiddenOpenCards:1,hiddenPaidCards:0,hiddenOneOnOneCards:1,cardCleanupFailed:true});
  assert.deepEqual(promoted,['male']);
  assert.deepEqual(calls.map(x=>x.table), ['dating_cards','dating_paid_cards','dating_1on1_cards']);
  const report=read('app/api/admin/dating/reports/[id]/ban/route.ts');
  assert.ok(report.indexOf('reportRes.data.status !== "open"') < report.indexOf('const banProfileRes'));
  assert.ok(report.indexOf('if (cleanup.cardCleanupFailed)') < report.indexOf('const resolveReportsRes'));
  assert.match(read('app/api/admin/users/ban/route.ts'), /await hideBannedMemberDatingCards/);
});
test('ops smoke is credentials-free, limited to known origins, and detects an admin data leak', async () => {
  for (const invalid of ['https://example.org','http://localhost:3100','https://api.helchang.com/admin','https://x@helchang.com']) {
    assert.throws(()=>getOrigin(invalid),/explicit GymTools/);
  }
  for (const leak of [false,true]) {
    const checks=await run('http://127.0.0.1:3130', async (url, init) => {
      assert.equal(init.credentials,'omit');
      assert.equal(init.method,'GET');
      assert.equal(init.redirect,'manual');
      return url.pathname.startsWith('/api/')
        ? Response.json(leak?{counts:{}}:{error:'unauthorized'},{status:401})
        : new Response('<html>짐툴</html>',{headers:{'content-type':'text/html'}});
    });
    assert.equal(checks.every(x=>x.ok),!leak);
  }
});
test('immediate outreach rechecks affirmative opt-in and excludes on lookup error before sending', () => {
  const route=read('app/api/admin/dating/cards/outreach/route.ts');
  assert.match(route,/fetchEmailMarketingExcludedUserIds as fetchMarketingUnsubscribedUserIds/);
  assert.match(route,/fetchMarketingUnsubscribedUserIds\(admin, batch\.map[\s\S]*?catch\(\(\) => new Set\(batch\.map/);
  assert.match(route,/eligible\.map\(async \(item\) => \{[\s\S]*?sendDatingEmailToAddressDetailed/);
});
test('admin dating CSV keeps the status fields, removes contact and free text, and writes formula-like values as text', () => {
  const {buildMaskedDatingCsv}=load('lib/admin-dating-export-csv.ts',{});
  const csv=buildMaskedDatingCsv(['card_id','phone','instagram_id','intro_text','admin_note','status','age'],
    [[ref(2),'01000000000','sample_actor','internal memo','another note',' =1+1',30]]);
  assert.equal(csv,'\uFEFFcard_id,phone,instagram_id,intro_text,admin_note,status,age\r\n'+ref(2)+",,,,,' =1+1,30");
  assert.match(read('app/api/admin/dating/export/route.ts'), /buildMaskedDatingCsv as buildCsv/);
});
test('catalog-only readiness checks effective writes and enabled RLS, not merely policy names', async () => {
  const {PGlite}=require('@electric-sql/pglite');
  const db=new PGlite();
  try {
    await db.exec('create role anon; create role authenticated');
    await db.exec('begin read only');
    const sql=read('supabase/sql/admin_operations_release_readiness.sql');
    const checks=async()=>Object.fromEntries((await db.query(sql)).rows.map(r=>[r.check_name,r.ok]));
    assert.ok(Object.values(await checks()).every(x=>!x));
    await db.exec('rollback');
    await db.exec(`create table admin_audit_logs(id int);
      alter table admin_audit_logs enable row level security;
      create table toss_test_payment_orders(status text);
      create table dating_cards(members_only boolean);
      create policy dating_cards_members_only_anon on dating_cards as restrictive for select to anon using(not members_only);
      grant insert(status) on toss_test_payment_orders to authenticated;`);
    await db.exec('begin read only');
    const partial=await checks();
    assert.equal(partial.existing_member_only_policy_enabled,false);
    assert.equal(partial.admin_audit_exists_with_rls,true);
    assert.equal(partial.member_cannot_create_payment_order_rows,false);
    assert.equal(partial.guest_cannot_create_payment_order_rows,true);
    await db.exec('rollback');
    await db.exec(`alter table dating_cards enable row level security;
      revoke insert(status) on toss_test_payment_orders from authenticated;`);
    await db.exec('begin read only');
    assert.ok(Object.values(await checks()).every(Boolean));
    await db.exec('rollback');
  } finally {await db.close();}
});
