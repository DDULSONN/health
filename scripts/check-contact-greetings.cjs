/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {runtime,id,read,load}=require('./fixtures/contact-nudge-read-runtime.cjs');
const migration='supabase/sql/dating_1on1_contact_greetings.sql';
const helpers=load('lib/dating-1on1-contact-nudge.ts');
const snapshot=async r=>(await r.db.query('select * from dating_1on1_match_proposals')).rows;

test('additive migration preserves historical messages, matching eligibility and privileges, including repeated install',async()=>{
  const r=await runtime();
  try{
    const before=await snapshot(r),old=(await r.db.query('select * from dating_1on1_contact_nudges')).rows;
    const trigger=(await r.db.query("select pg_get_functiondef('validate_dating_1on1_contact_nudge()'::regprocedure) body")).rows;
    for(let i=0;i<2;i++)await r.db.exec(read(migration));
    assert.deepEqual(await snapshot(r),before);
    assert.deepEqual((await r.db.query('select * from dating_1on1_contact_nudges')).rows,old);
    assert.deepEqual((await r.db.query("select pg_get_functiondef('validate_dating_1on1_contact_nudge()'::regprocedure) body")).rows,trigger);
    for(const role of ['anon','authenticated']){
      assert.equal((await r.db.query("select has_function_privilege($1,'dating_1on1_contact_greetings_version()','EXECUTE') ok",[role])).rows[0].ok,false);
      for(const access of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await r.db.query("select has_table_privilege($1,'dating_1on1_contact_nudges',$2) ok",[role,access])).rows[0].ok,false);
    }
    await r.db.exec('set role service_role');assert.equal((await r.db.query('select dating_1on1_contact_greetings_version() v')).rows[0].v,1);await r.db.exec('reset role');
  }finally{await r.db.close();}
});

test('every new and old preset goes through actual API and SQL, canonical Korean notification, no match or phone change',async()=>{
  const r=await runtime();
  try{
    const before=await snapshot(r);await r.db.exec(read(migration));
    for(const preset of [...helpers.ONE_ON_ONE_CONTACT_NUDGE_PRESETS,...helpers.ONE_ON_ONE_CONTACT_GREETING_PRESETS]){
      await r.db.exec('delete from dating_1on1_contact_nudges');r.calls.length=0;
      const response=await r.routes(id(1)).send(r.request({presetKey:preset.key,message_text:'forged'}),r.params);
      assert.equal(response.status,200);assert.equal((await response.json()).nudge.message_text,preset.message);
      const notice=r.calls.find(c=>c.notification)?.notification,email=r.calls.find(c=>c.email)?.email;
      assert.ok(notice.body.includes(preset.message));assert.ok(email.text.includes(preset.message));assert.doesNotMatch(email.subject+email.text,/�/);
      const list=await(await r.routes(id(2)).get(new Request('https://example.test/my'))).json();
      assert.equal(list.items[0].contact_nudge.greetings_available,true);
      assert.equal(list.items[0].contact_nudge.received_from_other.message_text,preset.message);
      assert.equal(list.items[0].counterparty_phone,null);
      assert.deepEqual(await snapshot(r),before);
      assert.equal((await r.routes(id(1)).send(r.request({presetKey:preset.key}),r.params)).status,409);
      assert.equal(r.calls.filter(c=>c.email).length,1);
    }
  }finally{await r.db.close();}
});

test('no migration falls back to old presets; new send fails safely without notifications; migration never relaxes payment/participant guards',async()=>{
  const r=await runtime();
  try{
    let result=await(await r.routes().get(new Request('https://example.test/my'))).json();
    assert.equal(result.items[0].contact_nudge.greetings_available,false);
    assert.ok(result.items[0].contact_nudge.received_from_other);
    assert.equal((await r.routes().send(r.request({presetKey:'nice_to_meet'}),r.params)).status,503);
    assert.equal(r.calls.filter(c=>c.email||c.notification).length,0);
    assert.equal((await r.routes().send(r.request({presetKey:'want_to_exchange'}),r.params)).status,200);
    await r.db.exec(read(migration));await r.db.exec('delete from dating_1on1_contact_nudges');
    const insert=(sender=id(1),text='반가워요. 편하게 이야기 나눠보고 싶어요 🙂')=>r.db.query("insert into dating_1on1_contact_nudges(match_id,sender_user_id,recipient_user_id,preset_key,message_text) values($1,$2,$3,'nice_to_meet',$4)",[id(10),sender,id(2),text]);
    await assert.rejects(insert(id(3)),/NUDGE_PARTICIPANT_MISMATCH/);
    await assert.rejects(insert(id(1),'tampered'),/preset_message/);
    for(const patch of ["state='admin_canceled'","state='mutual_accepted',contact_exchange_status='approved'","contact_exchange_status='awaiting_applicant_payment',contact_exchange_paid_at=now()"]){
      await r.db.exec('update dating_1on1_match_proposals set '+patch);await assert.rejects(insert(),/NUDGE_NOT_ELIGIBLE/);
    }
  }finally{await r.db.close();}
});

test('capability reader accepts only version 1 and isolates RPC errors/timeouts',async()=>{
  const {loadOneOnOneContactGreetingsAvailable:readCapability}=load('lib/dating-1on1-contact-nudge-policy.ts');
  for(const data of [null,0,1,2,'1']){
    const client={rpc(name){assert.equal(name,'dating_1on1_contact_greetings_version');return {abortSignal(signal){assert.ok(signal instanceof AbortSignal);return Promise.resolve({data,error:null});}};}};
    assert.equal(await readCapability(client),data===1);
  }
  for(const client of [{rpc(){throw Error('offline');}},{rpc(){return{abortSignal(){return Promise.reject(Error('timeout'));}};}},{rpc(){return{abortSignal(){return Promise.resolve({data:1,error:{code:'PGRST202'}});}};}}])assert.equal(await readCapability(client),false);
});
