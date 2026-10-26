/* eslint-disable @typescript-eslint/no-require-imports */
const assert=require('node:assert/strict'),{test}=require('node:test'),ts=require('typescript');
const {createRewardDb,id,read}=require('./fixtures/first-profile-reward-db.cjs');
function load(file,overrides={}){const m={exports:{}};const code=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',code)(n=>overrides[n]||(n.startsWith('@/')?load(n.slice(2)+'.ts',overrides):require(n)),m,m.exports);return m.exports;}
const first=state=>({campaignKey:'first-profile-2026-10',credits:1,state});
const returning=state=>({campaignKey:'return-profile-2026-10',credits:5,state});
test('strict one/five-credit schemas reject mismatched promises and untrusted amounts',()=>{
 const model=load('lib/first-profile-reward.ts');
 for(const state of ['eligible','ready','rewarded'])for(const v of [first(state),returning(state)])assert.ok(model.isProfileReward(v));
 for(const v of [null,{},first('unknown'),{...first('eligible'),credits:5},{...returning('eligible'),credits:1},{...first('ready'),campaignKey:'bad'}])assert.equal(model.isProfileReward(v),false);
});
test('single endpoint: return reward precedence, optional rollout, failure stays isolated',async()=>{
 const helper=load('lib/return-profile-reward-server.ts');let result={data:first('eligible'),error:null},old={data:null,error:null},calls=[];
 const admin={rpc:(name,args)=>{calls.push([name,args]);return{abortSignal:()=>Promise.resolve(name.includes('return_profile')?old:result)};}};
 assert.deepEqual(await helper.readProfileReward(admin,'alice'),first('eligible'));
 assert.deepEqual(calls.map(x=>x[0]),['return_profile_reward_status','first_profile_reward_status']);calls=[];
 old={data:returning('eligible'),error:null};assert.deepEqual(await helper.readProfileReward(admin,'alice',true),returning('eligible'));
 assert.deepEqual(calls.map(x=>x[0]),['claim_return_profile_reward']);old={data:null,error:null};
 for(const code of ['PGRST202','PGRST205','42P01','42883']){result={data:null,error:{code}};assert.equal(await helper.readProfileReward(admin,'alice'),null);}
 result={data:{...first('ready'),credits:5},error:null};await assert.rejects(helper.readProfileReward(admin,'alice'),/INVALID_RESPONSE/);
 result={data:null,error:{code:'XX000'}};await assert.rejects(helper.readProfileReward(admin,'alice'),/UNAVAILABLE/);
 await helper.grantReturnProfileRewardSafely(admin,'alice');
 old={data:null,error:{code:'XX000'}};calls=[];await assert.rejects(helper.readProfileReward(admin,'alice',true));assert.equal(calls.length,1,'no first grant after ambiguous return-grant failure');
});
test('real SQL: fixed safe cohort, independent optional install, historical deletion excluded',async()=>{
 const f=await createRewardDb(),{db,member,card,status,claim,credits}=f;
 try{
  for(let n=1;n<=12;n++)await member(n);
  await card(2);await card(3,'rejected');
  await db.query('insert into dating_1on1_metric_events(user_id,event_kind) values($1,\'application_created\')',[id(4)]);
  await db.query('insert into return_profile_reward_members values($1)',[id(5)]);
  await db.query('update profiles set is_banned=true where user_id=$1',[id(6)]);
  await db.query("update profiles set role='admin' where user_id=$1",[id(7)]);
  await db.query('update auth.users set deleted_at=now() where id=$1',[id(8)]);
  await db.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[id(9)]);
  await db.query('update profiles set phone_verified=false where user_id=$1',[id(10)]);
  assert.equal(await status(1),null);assert.equal(await claim(1),null);assert.equal(await credits(1),0);
  await db.exec(read('supabase/sql/first_profile_reward_activate.sql'));
  assert.deepEqual((await db.query('select user_id from first_profile_reward_members order by user_id')).rows.map(x=>x.user_id),[1,10,11,12].map(id));
  assert.deepEqual(await status(1),first('eligible'));assert.deepEqual(await status(10),first('eligible'));assert.equal(await credits(1),0);
  await member(13);await db.query('delete from dating_1on1_cards where user_id=$1',[id(2)]);
  await db.exec(read('supabase/sql/first_profile_reward.sql'));await db.exec(read('supabase/sql/first_profile_reward_activate.sql'));
  assert.equal(await status(2),null);assert.equal(await status(13),null,'new registrations are not retroactively enrolled');
  await db.query('delete from auth.users where id=$1',[id(11)]);await member(11);
  await db.exec(read('supabase/sql/first_profile_reward_activate.sql'));assert.equal(await status(11),null,'deleted/recreated account cannot re-enroll');
  await card(10);assert.deepEqual(await claim(10),first('eligible'));assert.equal(await credits(10),0);
  await db.query('update profiles set phone_verified=true where user_id=$1',[id(10)]);assert.deepEqual(await claim(10),first('rewarded'));assert.equal(await credits(10),1);
 }finally{await db.close();}
});
test('real SQL: validated completion, atomic +1 preserving balance, retries and rollback',async()=>{
 const {db,member,card,status,claim,credits}=await createRewardDb();
 try{
  for(let n=1;n<=7;n++)await member(n);await db.exec(read('supabase/sql/first_profile_reward_activate.sql'));
  await db.query('insert into user_apply_credits(user_id,credits) values($1,9)',[id(1)]);
  await card(1);assert.deepEqual(await status(1),first('ready'));assert.equal(await credits(1),9,'GET is read-only');
  await db.exec('alter table apply_credit_orders add constraint force_rollback check(amount<>0)');await assert.rejects(claim(1));
  assert.equal(await credits(1),9);assert.deepEqual(await status(1),first('ready'));
  await db.exec('alter table apply_credit_orders drop constraint force_rollback');
  const results=await Promise.all(Array.from({length:12},()=>claim(1)));assert.ok(results.every(x=>x.state==='rewarded'));
  assert.equal(await credits(1),10);const ledger=(await db.query('select pack_size,amount,status,memo from apply_credit_orders where user_id=$1',[id(1)])).rows;
  assert.equal(ledger.length,1);assert.equal(ledger[0].pack_size,1);assert.equal(ledger[0].amount,0);assert.equal(ledger[0].status,'approved');
  await db.query('delete from dating_1on1_cards where user_id=$1',[id(1)]);await card(1);await claim(1);assert.equal(await credits(1),10);
  await db.query('delete from apply_credit_orders where user_id=$1',[id(1)]);await claim(1);assert.equal(await credits(1),10);
  await card(2,'rejected');assert.equal((await claim(2)).state,'eligible');
  await db.query("update dating_1on1_cards set status='submitted' where user_id=$1",[id(2)]);
  for(const photos of [{},[],[null,null],[1,2],['foreign/a','foreign/b'],['cards/'+id(2)+'/a','cards/'+id(2)+'/a'],['cards/'+id(2)+'/','cards/'+id(2)+'/b']]){
   await db.query('update dating_1on1_cards set photo_paths=$2::jsonb where user_id=$1',[id(2),JSON.stringify(photos)]);assert.equal((await claim(2)).state,'eligible');assert.equal(await credits(2),0);
  }
  await card(3,'submitted',['a','b'],'2020-01-01');assert.equal((await claim(3)).state,'eligible','existing profile edits do not qualify');
  await card(4);await db.query('update dating_1on1_cards set consent_privacy=false where user_id=$1',[id(4)]);assert.equal((await claim(4)).state,'eligible');
  await card(5);await db.query('update profiles set is_banned=true where user_id=$1',[id(5)]);assert.equal(await claim(5),null);
  await card(6);await db.query('update auth.users set deleted_at=now() where id=$1',[id(6)]);assert.equal(await claim(6),null);
  await card(7);await db.query('insert into return_profile_reward_members values($1)',[id(7)]);assert.equal(await claim(7),null,'never double-grant returning member');
 }finally{await db.close();}
});
test('real SQL: paused migration stays paused, service-only permissions, no membership writes',async()=>{
 const {db,member,card,status,claim,credits}=await createRewardDb();
 try{
  await member(1);await db.exec(read('supabase/sql/first_profile_reward_activate.sql'));await card(1);
  await db.exec('update first_profile_reward_campaign set enabled=false');await db.exec(read('supabase/sql/first_profile_reward.sql'));await db.exec(read('supabase/sql/first_profile_reward_activate.sql'));
  assert.equal(await status(1),null);assert.equal(await claim(1),null);assert.equal(await credits(1),0);
  await db.exec('update first_profile_reward_campaign set enabled=true');
  for(const role of ['anon','authenticated']){
   await db.exec('set role '+role);
   for(const sql of ['select * from first_profile_reward_members','select * from first_profile_reward_campaign','select activate_first_profile_reward()',`select first_profile_reward_status('${id(1)}')`,`select claim_first_profile_reward('${id(1)}')`,`select first_profile_reward_card('${id(1)}',now())`])await assert.rejects(db.query(sql),/permission denied/);
   await db.exec('reset role');
  }
  await db.exec('set role service_role');assert.deepEqual(await claim(1),first('rewarded'));
  await assert.rejects(db.exec('update first_profile_reward_members set rewarded_at=null'),/permission denied/);
  await assert.rejects(db.query(`select first_profile_reward_card('${id(1)}',now())`),/permission denied/);
 }finally{await db.close();}
});
test('API -> real local SQL -> confirmed credit response; malicious caller body rejected',async()=>{
 const {db,member,card,credits}=await createRewardDb();
 try{
  await member(1);await member(2);await db.exec(read('supabase/sql/first_profile_reward_activate.sql'));await card(1);
  const admin={rpc:(name,args)=>({abortSignal:async()=>{
   if(name.includes('return_profile'))return {data:null,error:null};
   assert.ok(['first_profile_reward_status','claim_first_profile_reward'].includes(name));
   return {data:(await db.query(`select ${name}($1) as v`,[args.p_user_id])).rows[0].v,error:null};
  }})};
  let user={id:id(1)};
  const route=load('app/api/return-profile-reward/route.ts',{'next/server':{NextResponse:{json:(v,o)=>Response.json(v,o)}},'@/lib/supabase/request':{getRequestAuthContext:async()=>({user})},'@/lib/supabase/server':{createAdminClient:()=>admin}});
  const req=(method,body)=>new Request('https://helchang.com/api/return-profile-reward?userId='+id(2),{method,headers:{host:'helchang.com',origin:'https://helchang.com'},body});
  const get=await route.GET(req('GET'));assert.deepEqual(await get.json(),{userId:id(1),reward:first('ready')});assert.equal(await credits(1),0);
  assert.equal((await route.POST(req('POST',JSON.stringify({userId:id(2),credits:99})))).status,400);assert.equal(await credits(2),0);
  const post=await route.POST(req('POST'));assert.deepEqual(await post.json(),{userId:id(1),reward:first('rewarded')});assert.equal(await credits(1),1);assert.equal(await credits(2),0);
  await route.POST(req('POST'));assert.equal(await credits(1),1);
  user=null;assert.equal((await route.POST(req('POST'))).status,401);
 }finally{await db.close();}
});
