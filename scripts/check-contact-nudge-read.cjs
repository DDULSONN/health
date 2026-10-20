/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test'), assert = require('node:assert/strict');
const {runtime,id,read,load} = require('./fixtures/contact-nudge-read-runtime.cjs');

test('recipient view saves once; sender sees persisted receipt; no match/payment/phone mutation', async () => {
  const r = await runtime();
  try {
    const snapshot = (await r.db.query('select * from dating_1on1_match_proposals')).rows;
    const before = await (await r.routes(id(1)).get(new Request('https://example.test/my'))).json();
    assert.equal(before.items[0].contact_nudge.sent_by_me.read_at,null);
    assert.equal(before.items[0].counterparty_phone,null);
    assert.equal(r.calls.filter(c=>c.rpc).length,0,'list load must not mark read');
    const first = await r.routes().post(r.request(),r.params);
    assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'private, no-store');
    const body = await first.json(); assert.ok(Date.parse(body.read_at));assert.equal(body.nudgeId,id(30));
    for (let i=0;i<3;i++) assert.equal((await (await r.routes().post(r.request(),r.params)).json()).read_at,body.read_at);
    await r.db.exec(read('supabase/sql/dating_1on1_contact_nudge_read_receipts.sql'));
    const after = await (await r.routes(id(1)).get(new Request('https://example.test/my'))).json();
    assert.equal(Date.parse(after.items[0].contact_nudge.sent_by_me.read_at), Date.parse(body.read_at));
    assert.equal(after.items[0].contact_nudge.read_receipts_available,true);
    assert.deepEqual((await r.db.query('select * from dating_1on1_match_proposals')).rows,snapshot);
    assert.equal((await r.db.query('select count(*)::int n from dating_1on1_contact_nudges')).rows[0].n,1);
    for (const status of ['none','awaiting_applicant_payment','payment_pending_admin','approved','canceled']) {
      await r.db.query('update dating_1on1_match_proposals set contact_exchange_status=$1',[status]);
      const result = await (await r.routes(id(1)).get(new Request('https://example.test/my'))).json();
      assert.equal(result.items[0].counterparty_phone,status==='approved'?'01000000002':null);
      assert.equal(result.items[0].contact_nudge.can_mark_read,status!=='canceled');
    }
  } finally {await r.db.close();}
});

test('real SQL rejects wrong recipient, foreign message, canceled, banned, deleted and blocked participants', async () => {
  const r = await runtime(), call = (recipient=id(2), nudge=id(30)) => r.db.query('select mark_dating_1on1_contact_nudge_read($1,$2,$3)',[id(10),nudge,recipient]);
  try {
    await assert.rejects(call(id(1)),/NUDGE_READ_NOT_FOUND/);
    await assert.rejects(call(id(3)),/NUDGE_READ_NOT_FOUND/);
    await assert.rejects(call(id(2),id(31)),/NUDGE_READ_NOT_FOUND/);
    for (const state of ['proposed','source_selected','candidate_rejected','admin_canceled',null]) {
      await r.db.query('update dating_1on1_match_proposals set state=$1',[state]);
      await assert.rejects(call(),/NUDGE_READ_UNAVAILABLE/);
    }
    await r.db.exec("update dating_1on1_match_proposals set state='mutual_accepted'");
    for (const status of ['canceled','unknown',null]) {
      await r.db.query('update dating_1on1_match_proposals set contact_exchange_status=$1',[status]);
      await assert.rejects(call(),/NUDGE_READ_UNAVAILABLE/);
    }
    await r.db.exec("update dating_1on1_match_proposals set contact_exchange_status='approved'");
    for (const member of [id(1),id(2)]) {
      await r.db.query('update profiles set is_banned=true where user_id=$1',[member]);
      await assert.rejects(call(),/NUDGE_READ_UNAVAILABLE/);
      await r.db.query('update profiles set is_banned=false where user_id=$1',[member]);
      await r.db.query('delete from profiles where user_id=$1',[member]);
      await assert.rejects(call(),/NUDGE_READ_UNAVAILABLE/);
      await r.db.query('insert into profiles(user_id) values ($1)',[member]);
    }
    await r.db.query('insert into dating_user_blocks values($1,$2)',[id(2),id(1)]);
    await assert.rejects(call(),/NUDGE_READ_UNAVAILABLE/);
    assert.equal((await r.db.query('select read_at from dating_1on1_contact_nudges')).rows[0].read_at,null);
    await r.db.exec('delete from dating_user_blocks');
    await r.db.exec('set role service_role');await call();await r.db.exec('reset role');
    for(const role of ['anon','authenticated']){
      assert.equal((await r.db.query("select has_function_privilege($1,'mark_dating_1on1_contact_nudge_read(uuid,uuid,uuid)','EXECUTE') ok",[role])).rows[0].ok,false);
      assert.equal((await r.db.query("select has_table_privilege($1,'dating_1on1_contact_nudges','UPDATE') ok",[role])).rows[0].ok,false);
    }
  } finally {await r.db.close();}
});

test('actual API authenticates origin/recipient and handles failures without reporting success', async () => {
  const r = await runtime();
  try {
    assert.equal((await r.routes(null).post(r.request(),r.params)).status,401);
    assert.equal((await r.routes(id(3)).post(r.request(),r.params)).status,404);
    assert.equal((await r.routes(id(1)).post(r.request({nudgeId:id(30),recipientUserId:id(2),read_at:'2000-01-01'}),r.params)).status,404);
    assert.equal((await r.routes().post(r.request(undefined,'https://evil.test'),r.params)).status,403);
    for(const body of [null,{}, {nudgeId:'bad'}, {nudgeId:12}])assert.equal((await r.routes().post(r.request(body),r.params)).status,400);
    for(const flag of ['blocked','contactBlocked','guardError']){
      r.flags[flag]=true;
      assert.equal((await r.routes().post(r.request(),r.params)).status,flag==='guardError'?503:409);
      r.flags[flag]=false;
    }
    r.flags.rpcError={code:'PGRST202'};
    assert.equal((await r.routes().post(r.request(),r.params)).status,503);
    r.flags.rpcError={code:'XX000',message:'offline'};
    assert.equal((await r.routes().post(r.request(),r.params)).status,503);
    assert.equal((await r.db.query('select read_at from dating_1on1_contact_nudges')).rows[0].read_at,null);
  } finally {await r.db.close();}
});

test('before migration, old messages and payments still load; only receipts are disabled', async () => {
  const r = await runtime({migrated:false});
  try {
    const result = await r.routes(id(1)).get(new Request('https://example.test/my'));
    assert.equal(result.status,200);
    const data = await result.json(), summary=data.items[0].contact_nudge;
    assert.equal(summary.available,true);assert.equal(summary.read_receipts_available,false);
    assert.equal(summary.can_mark_read,false);assert.match(summary.sent_by_me.message_text,/첫 커피/);
    assert.equal(summary.sent_by_me.read_at,null);assert.equal(data.items[0].counterparty_phone,null);
    assert.equal(r.calls.filter(c=>c.table==='dating_1on1_contact_nudges').length,2);
  } finally {await r.db.close();}
});

test('legacy installation without optional member-block table still records authorized receipts', async () => {
  const r=await runtime();
  try {
    await r.db.exec('drop table dating_user_blocks');
    await r.db.exec(read('supabase/sql/dating_1on1_contact_nudge_read_receipts.sql'));
    const result=await r.routes().post(r.request(),r.params);
    assert.equal(result.status,200);assert.ok((await result.json()).read_at);
  } finally {await r.db.close();}
});

test('narrow rollout fallback and sender copy do not claim historic messages were unread', () => {
  const helpers=load('lib/dating-1on1-contact-nudge.ts');
  assert.equal(helpers.isMissingContactNudgeReadColumn({code:'42703',message:'column read_at does not exist'}),true);
  for(const error of [{code:'42P01',message:'read_at'}, {code:'42703',message:'column created_at does not exist'}, {code:'XX000',message:'read_at'}])assert.equal(helpers.isMissingContactNudgeReadColumn(error),false);
  const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
  const Component=load('components/dating/OneOnOneContactNudge.tsx').default;
  for(const read_at of [null,'2026-10-20T10:00:00Z']){
    const html=renderToStaticMarkup(React.createElement(Component,{matchId:id(10),processing:false,onSend(){throw Error('No send');},
      nudge:{available:true,read_receipts_available:true,sent_by_me:{message_text:'안녕하세요 ☕',read_at}}}));
    assert.match(html,read_at?/상대가 확인함/:/확인 기록 없음/);assert.doesNotMatch(html,/미확인|확인 버튼|�/);
  }
  const sql=read('supabase/sql/dating_1on1_contact_nudge_read_receipts.sql');
  assert.doesNotMatch(sql,/update\s+public\.dating_1on1_match_proposals|delete\s+from|toss_test_payment_orders/i);
});
