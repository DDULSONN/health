/* eslint-disable @typescript-eslint/no-require-imports */
const {test} = require('node:test'), assert = require('node:assert/strict');
const {runtime,id,read,load} = require('./fixtures/contact-nudge-read-runtime.cjs');
const migration = 'supabase/sql/dating_1on1_contact_nudge_replies.sql';
const valid = {nudgeId:id(30),presetKey:'happy_to_talk'};
const helpers = load('lib/dating-1on1-contact-reply.ts');
const init = async options => {const r=await runtime(options);await r.db.exec(read(migration));return r;};

test('reply through actual route and SQL persists for both members without changing any match/nudge/payment/phone data',async()=>{
  const r=await init();
  try {
    const before=(await r.db.query('select * from dating_1on1_match_proposals')).rows;
    const nudgeBefore=(await r.db.query('select * from dating_1on1_contact_nudges')).rows;
    const first=await r.routes().reply(r.request(valid),r.params);
    assert.equal(first.status,200);assert.equal(first.headers.get('cache-control'),'private, no-store');
    const data=await first.json();assert.equal(data.reply.message_text,'좋아요, 연락 나눠봐요.');
    // Sequential retries and simultaneous deliveries cannot overwrite the first reply.
    const results=await Promise.all(Array.from({length:8},(_,i)=>r.routes().reply(r.request({...valid,presetKey:i%2?'not_right_now':'available_this_week'}),r.params)));
    for(const result of results)assert.deepEqual((await result.json()).reply,data.reply);
    assert.equal((await r.db.query('select count(*)::int n from dating_1on1_contact_nudge_replies')).rows[0].n,1);
    for(const member of [id(1),id(2)]){
      const result=await (await r.routes(member).get(new Request('https://example.test/my'))).json();
      const nudge=result.items[0].contact_nudge;
      assert.equal(nudge.replies_available,true);assert.equal(nudge.can_reply,false);
      assert.equal((member===id(1)?nudge.sent_by_me:nudge.received_from_other).reply.message_text,data.reply.message_text);
      assert.equal(result.items[0].counterparty_phone,null);
    }
    assert.deepEqual((await r.db.query('select * from dating_1on1_match_proposals')).rows,before);
    assert.deepEqual((await r.db.query('select * from dating_1on1_contact_nudges')).rows,nudgeBefore);
    await r.db.exec(read(migration));
    assert.equal((await r.db.query('select count(*)::int n from dating_1on1_contact_nudge_replies')).rows[0].n,1);
    // Later payment still uses the existing approval rule; reply history is retained.
    await r.db.exec("update dating_1on1_match_proposals set contact_exchange_status='approved',contact_exchange_paid_at=now()");
    const after=await(await r.routes(id(1)).get(new Request('https://example.test/my'))).json();
    assert.equal(after.items[0].counterparty_phone,'01000000002');
    assert.ok(after.items[0].contact_nudge.sent_by_me.reply);
    assert.equal((await r.routes().reply(r.request(valid),r.params)).status,409);
  } finally {await r.db.close();}
});

test('every preset is canonical Korean and no preset changes match state',async()=>{
  const r=await init();
  try{
    const before=(await r.db.query('select * from dating_1on1_match_proposals')).rows;
    for(const preset of helpers.ONE_ON_ONE_CONTACT_REPLY_PRESETS){
      await r.db.exec('delete from dating_1on1_contact_nudge_replies');
      const result=await r.routes().reply(r.request({...valid,presetKey:preset.key,message_text:'forged contact',recipientUserId:id(3)}),r.params);
      assert.equal(result.status,200);assert.equal((await result.json()).reply.message_text,preset.message);
      assert.deepEqual((await r.db.query('select * from dating_1on1_match_proposals')).rows,before);
    }
    assert.equal(helpers.getOneOnOneContactReplyPreset('arbitrary'),null);
    for(const value of [null,{}, {preset_key:'happy_to_talk',created_at:'bad'}])assert.equal(helpers.parseOneOnOneContactReply(value),null);
  }finally{await r.db.close();}
});

test('API rejects unauthenticated, foreign-origin, non-recipient and invalid requests; phone/member blocks fail closed',async()=>{
  const r=await init();
  try{
    assert.equal((await r.routes(null).reply(r.request(valid),r.params)).status,401);
    assert.equal((await r.routes(id(3)).reply(r.request(valid),r.params)).status,404);
    assert.equal((await r.routes(id(1)).reply(r.request({...valid,recipientUserId:id(2)}),r.params)).status,404);
    assert.equal((await r.routes().reply(r.request(valid,'https://evil.test'),r.params)).status,403);
    for(const body of [null,{}, {nudgeId:id(30)}, {...valid,presetKey:'free text'}, {...valid,nudgeId:'bad'}]){
      assert.equal((await r.routes().reply(r.request(body),r.params)).status,400);
    }
    assert.equal((await r.routes().reply(r.request(valid),{params:Promise.resolve({id:'bad'})})).status,400);
    for(const flag of ['blocked','contactBlocked','guardError']){
      r.flags[flag]=true;assert.equal((await r.routes().reply(r.request(valid),r.params)).status,flag==='guardError'?503:409);r.flags[flag]=false;
    }
    for(const error of [{code:'PGRST202'},{code:'XX000'},{message:'NUDGE_REPLY_UNAVAILABLE'}]){
      r.flags.rpcError=error;assert.equal((await r.routes().reply(r.request(valid),r.params)).status,error.message?409:503);
    }
    assert.equal((await r.db.query('select count(*)::int n from dating_1on1_contact_nudge_replies')).rows[0].n,0);
  }finally{await r.db.close();}
});

test('SQL rechecks cancellation/payment/bans/deletions/blocks, wrong nudge/recipient and access grants',async()=>{
  const r=await init();
  const call=(recipient=id(2),nudge=id(30),key='happy_to_talk')=>r.db.query('select reply_dating_1on1_contact_nudge($1,$2,$3,$4)',[id(10),nudge,recipient,key]);
  try{
    for(const user of [id(1),id(3)])await assert.rejects(call(user),/NUDGE_REPLY_NOT_FOUND/);
    await assert.rejects(call(id(2),id(31)),/NUDGE_REPLY_NOT_FOUND/);
    for(const key of [null,'arbitrary'])await assert.rejects(call(id(2),id(30),key),/INVALID_PRESET/);
    for(const state of [null,'proposed','source_selected','source_declined','candidate_rejected','admin_canceled']){
      await r.db.query('update dating_1on1_match_proposals set state=$1',[state]);await assert.rejects(call(),/UNAVAILABLE/);
    }
    await r.db.exec("update dating_1on1_match_proposals set state='mutual_accepted'");
    for(const status of [null,'none','approved','payment_pending_admin','canceled']){
      await r.db.query('update dating_1on1_match_proposals set contact_exchange_status=$1',[status]);await assert.rejects(call(),/UNAVAILABLE/);
    }
    await r.db.exec("update dating_1on1_match_proposals set contact_exchange_status='awaiting_applicant_payment',contact_exchange_paid_at=now()");
    await assert.rejects(call(),/UNAVAILABLE/);
    await r.db.query('update dating_1on1_match_proposals set contact_exchange_paid_at=null,contact_exchange_paid_by_user_id=$1',[id(1)]);
    await assert.rejects(call(),/UNAVAILABLE/);
    await r.db.exec('update dating_1on1_match_proposals set contact_exchange_paid_by_user_id=null');
    await r.db.exec('update dating_1on1_match_proposals set contact_exchange_approved_at=now()');
    await assert.rejects(call(),/UNAVAILABLE/);
    await r.db.exec('update dating_1on1_match_proposals set contact_exchange_approved_at=null');
    for(const member of [id(1),id(2)]){
      await r.db.query('update auth.users set deleted_at=now() where id=$1',[member]);await assert.rejects(call(),/UNAVAILABLE/);
      await r.db.query("update auth.users set deleted_at=null,banned_until=now()+interval '1 hour' where id=$1",[member]);await assert.rejects(call(),/UNAVAILABLE/);
      await r.db.query('update auth.users set banned_until=null where id=$1',[member]);
      await r.db.query('update profiles set is_banned=true where user_id=$1',[member]);await assert.rejects(call(),/UNAVAILABLE/);
      await r.db.query('delete from profiles where user_id=$1',[member]);await assert.rejects(call(),/UNAVAILABLE/);
      await r.db.query('insert into profiles(user_id) values($1)',[member]);
    }
    for(const pair of [[id(1),id(2)],[id(2),id(1)]]){
      await r.db.query('insert into dating_user_blocks values($1,$2)',pair);await assert.rejects(call(),/UNAVAILABLE/);await r.db.exec('delete from dating_user_blocks');
    }
    for(const role of ['anon','authenticated']){
      assert.equal((await r.db.query("select has_function_privilege($1,'reply_dating_1on1_contact_nudge(uuid,uuid,uuid,text)','EXECUTE') ok",[role])).rows[0].ok,false);
      for(const privilege of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await r.db.query("select has_table_privilege($1,'dating_1on1_contact_nudge_replies',$2) ok",[role,privilege])).rows[0].ok,false);
    }
    for(const privilege of ['INSERT','UPDATE','DELETE'])assert.equal((await r.db.query("select has_table_privilege('service_role','dating_1on1_contact_nudge_replies',$1) ok",[privilege])).rows[0].ok,false);
    await r.db.exec('drop table dating_user_blocks; set role service_role');await call();await r.db.exec('reset role');
    assert.equal((await r.db.query('select count(*)::int n from dating_1on1_contact_nudge_replies')).rows[0].n,1);
  }finally{await r.db.close();}
});

test('pre-migration, optional lookup outage, and legacy read schema do not break match/contact results',async()=>{
  const r=await runtime({migrated:false});
  try{
    let data=await(await r.routes().get(new Request('https://example.test/my'))).json();
    assert.equal(data.items[0].contact_nudge.replies_available,false);assert.ok(data.items[0].contact_nudge.received_from_other);
    assert.equal((await r.routes().reply(r.request(valid),r.params)).status,503);
    await r.db.exec(read(migration));
    assert.equal((await r.routes().reply(r.request(valid),r.params)).status,200);
    data=await(await r.routes().get(new Request('https://example.test/my'))).json();
    assert.equal(data.items[0].contact_nudge.read_receipts_available,false);assert.ok(data.items[0].contact_nudge.received_from_other.reply);
    const {loadOneOnOneContactReplies}=load('lib/dating-1on1-contact-replies-server.ts');
    const failure=await loadOneOnOneContactReplies({from(){throw Error('network');}},[id(30)]);
    assert.equal(failure.available,false);
    const batches=[];
    const admin={from(){const q={select(){return q;},in(k,ids){batches.push(ids);return q;},abortSignal(){return Promise.resolve({data:[],error:null});}};return q;}};
    assert.equal((await loadOneOnOneContactReplies(admin,Array.from({length:450},(_,i)=>id(i+100)))).available,true);
    assert.deepEqual(batches.map(b=>b.length),[200,200,50]);
  }finally{await r.db.close();}
});
