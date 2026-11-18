/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),source=id(2),before=Array.from({length:13},(_,i)=>id(10+i)),incoming=[id(30),id(31),id(32)];
const key=require('node:crypto').createHash('md5').update('male:1996:서울').digest('hex');
const sql=n=>fs.readFileSync(path.join(__dirname,'../supabase/sql/'+n+'.sql'),'utf8');
test('automatic partial repair: actual PostgreSQL invariants',async t=>{
 const db=new PGlite();const rows=async(q,p)=>(await db.query(q,p)).rows;
 try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
   create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
   create table profiles(user_id uuid primary key,is_banned boolean default false,phone_e164 text);
   create table dating_1on1_cards(id uuid primary key,user_id uuid,sex text,status text,birth_year integer,region text,
     recommendation_refresh_used_at timestamptz,updated_at timestamptz,created_at timestamptz default now()-interval '60 days',intro_text text,phone text);
   create table dating_1on1_recommendation_refresh_events(id bigint generated always as identity,card_id uuid,user_id uuid,
     refreshed_at timestamptz,quota_refunded_at timestamptz,rotation_only boolean default false);
   create table dating_1on1_recommendation_pages(user_id uuid primary key,source_card_id uuid,refreshed_at timestamptz,
     source_profile_key text,main_candidate_ids uuid[],extra_candidate_ids uuid[]);
   create table dating_1on1_match_proposals(id uuid primary key default gen_random_uuid(),source_user_id uuid,candidate_user_id uuid,state text,contact text);
   create table dating_1on1_candidate_hides(user_id uuid,candidate_user_id uuid);
   create table dating_1on1_candidate_favorites(user_id uuid,candidate_card_id uuid);
   create table dating_user_blocks(blocker_user_id uuid,blocked_user_id uuid);
   create table dating_1on1_admin_user_blocks(user_a_id uuid,user_b_id uuid);
   create table dating_1on1_phone_blocks(user_id uuid,created_at timestamptz);
   create table dating_contact_blocks(user_id uuid,created_at timestamptz);
   create table dating_1on1_candidate_impressions(viewer_user_id uuid,candidate_user_id uuid,first_seen_at timestamptz);
   create table dating_1on1_expansion_batches(user_id uuid,day_key date,candidate_ids uuid[]);
   create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,meta_json jsonb,created_at timestamptz default clock_timestamp());
   create table purchases(id uuid primary key,amount integer); insert into purchases values('${id(90)}',18000);
   create table dating_1on1_refresh_compensations(user_id uuid,granted_count integer,used_count integer);
   insert into dating_1on1_refresh_compensations values('${owner}',2,1);
   insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state,contact) values('${owner}','${id(99)}','mutual_accepted','unchanged-contact');`);
  for(const uid of [owner,...before,...incoming]){await db.query('insert into auth.users(id) values($1)',[uid]);await db.query('insert into profiles(user_id) values($1)',[uid]);}
  const stamp=new Date(Date.now()-3600000).toISOString();
  await db.query(`insert into dating_1on1_cards(id,user_id,sex,status,birth_year,region,recommendation_refresh_used_at,updated_at,intro_text) values($1,$2,'male','approved',1996,'서울',$3,$3,'untouched')`,[source,owner,stamp]);
  for(const uid of [...before,...incoming])await db.query(`insert into dating_1on1_cards(id,user_id,sex,status,birth_year,region,intro_text) values($1,$1,'female','approved',1998,'서울','untouched')`,[uid]);
  await db.query('insert into dating_1on1_recommendation_pages values($1,$2,$3,$4,$5,$6)',[owner,source,stamp,key,before.slice(0,10),before.slice(10)]);
  await db.exec(sql('dating_1on1_recommendation_page_history'));
  await db.exec(sql('dating_1on1_refresh_monitor'));
  await db.exec(sql('dating_1on1_partial_refresh_monitor'));
  await db.exec(sql('dating_1on1_partial_refresh_monitor'));
  const setting=async(mode='repair',enabled=true)=>db.query('update dating_1on1_refresh_monitor_settings set mode=$1,partial_enabled=$2,email_enabled=true',[mode,enabled]);
  await db.query(`insert into dating_1on1_refresh_attempts(id,user_id,source_card_id,created_at,expected_refresh_at,planned_at,source_profile_key,outcome,persist_page,
    changed_count,rotated_count,before_candidate_ids,before_user_ids,after_user_ids,main_candidate_ids,extra_candidate_ids,pool_count,safe_local_change)
    values($1,$2,$3,now()-interval '1 day',$4,$4,$5,'rotated',true,0,3,$6,$6,$6,$7,$8,50,true)`,[id(80),owner,source,stamp,key,before,before.slice(0,10),before.slice(10)]);
  for(const uid of before)await db.query(`insert into dating_1on1_candidate_impressions values($1,$2,now()-interval '2 days')`,[owner,uid]);
  const claim=async()=>(await rows('select claim_dating_1on1_refresh_audit() j'))[0].j;
  const makePlan=async(count=3)=>({source_card_id:source,expected_refresh_used_at:stamp,source_profile_key:key,refresh_at:new Date().toISOString(),persist_page:true,
    changed_candidate_count:count,rotated_candidate_count:count,main_candidate_ids:[...incoming.slice(0,count),...before.slice(count,10)],extra_candidate_ids:before.slice(10),monitor:{safe_local_change:true},
    partial:{expected_main:before.slice(0,10),expected_extra:before.slice(10),repeats:13,
      changes:incoming.slice(0,count).map((to,index)=>({index,from:before[index],to,beforeKm:50,afterKm:10})),
      profiles:await rows("select id,user_id,sex,birth_year,region,status,md5('') phone_key from dating_1on1_cards where id=any($1::uuid[])",[ [source,...before,...incoming.slice(0,count)] ])}});
  const call=async(job,p)=>(await rows('select repair_dating_1on1_partial_audit($1,$2,$3::jsonb) result',[job.id,job.lease_token,JSON.stringify(p??await makePlan())]))[0].result;
  const snap=async()=>{const out={};for(const table of ['dating_1on1_cards','dating_1on1_recommendation_pages','dating_1on1_recommendation_page_history','dating_1on1_recommendation_refresh_events','dating_1on1_match_proposals','purchases','dating_1on1_refresh_compensations','notifications','dating_1on1_refresh_audits'])out[table]=await rows('select * from '+table+' order by 1');return out;};
  const isolated=async(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
  await isolated('migration is disabled and idempotent',async()=>assert.deepEqual((await rows('select mode,partial_enabled,email_enabled from dating_1on1_refresh_monitor_settings'))[0],{mode:'observe',partial_enabled:false,email_enabled:false}));
  await isolated('anonymous and member roles have no new permission',async()=>{
    for(const role of ['anon','authenticated'])assert.equal((await rows("select has_function_privilege($1,'repair_dating_1on1_partial_audit(uuid,uuid,jsonb)','execute') yes",[role]))[0].yes,false);
    assert.equal((await rows("select has_function_privilege('service_role','repair_dating_1on1_partial_audit(uuid,uuid,jsonb)','execute') yes"))[0].yes,true);
  });
  for(const count of [1,2,3])await isolated(`exactly ${count} slots plus atomic notice/outbox; paid matches and quotas unchanged`,async()=>{
    await setting();const {job}=await claim(),a=await snap();assert.equal(await call(job,await makePlan(count)),'repaired');const b=await snap();
    for(const table of ['dating_1on1_match_proposals','purchases','dating_1on1_refresh_compensations'])assert.deepEqual(b[table],a[table]);
    assert.deepEqual(b.dating_1on1_recommendation_pages[0].extra_candidate_ids,before.slice(10));
    assert.equal(b.dating_1on1_recommendation_refresh_events.filter(e=>!e.quota_refunded_at).length,1);
    assert.equal(b.dating_1on1_recommendation_refresh_events.filter(e=>e.rotation_only&&e.quota_refunded_at).length,1);
    assert.equal(b.notifications.length,1);assert.equal(b.notifications[0].meta_json.changed_count,count);
    assert.equal(b.dating_1on1_refresh_audits.find(j=>j.id===job.id).email_state,'pending');
    assert.equal(b.dating_1on1_recommendation_page_history.length,2);
    assert.equal(await call(job),'already_repaired');assert.deepEqual(await snap(),b);
  });
  for(const charged of [0,1,2,5])await isolated(`existing ${charged} charged events survive`,async()=>{
    await setting();const {job}=await claim();
    for(let i=0;i<Math.max(1,charged);i++)await db.query(`insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at,quota_refunded_at,rotation_only) values($1,$2,$3,$4,$5)`,[source,owner,new Date(Date.parse(stamp)-i*1000).toISOString(),charged?null:stamp,!charged]);
    assert.equal(await call(job),'repaired');assert.equal((await rows('select count(*)::int n from dating_1on1_recommendation_refresh_events where quota_refunded_at is null'))[0].n,charged);
  });
  for(const [name,mutate,reason] of [
    ['extra changes',p=>p.extra_candidate_ids=[], 'invalid_partial'],
    ['short main',p=>p.main_candidate_ids.pop(),'invalid_partial'],
    ['no change',p=>{p.main_candidate_ids=before.slice(0,10);p.changed_candidate_count=0;},'invalid_partial'],
    ['duplicate person',p=>p.main_candidate_ids[1]=p.main_candidate_ids[0],'invalid_partial'],
    ['stale seed',p=>p.expected_refresh_used_at=new Date().toISOString(),'stale_plan'],
    ['stale page',p=>p.partial.expected_main.reverse(),'stale_plan'],
    ['stale plan',p=>p.refresh_at=new Date(Date.now()-180000).toISOString(),'stale_plan'],
    ['future plan',p=>p.refresh_at=new Date(Date.now()+60000).toISOString(),'stale_plan'],
    ['profile mismatch',p=>p.partial.profiles[0].region='제주','profile_changed'],
    ['longer distance',p=>p.partial.changes[0].afterKm=80,'fit_changed'],
    ['distant',p=>{p.partial.changes[0].afterKm=100;p.partial.changes[0].beforeKm=200;},'fit_changed'],
    ['unknown distance',p=>p.partial.changes[0].afterKm=null,'fit_changed'],
    ['index forgery',p=>p.partial.changes[0].index=9,'fit_changed'],
  ])await isolated(name,async()=>{await setting();const {job}=await claim(),p=await makePlan();mutate(p);const a=await snap();assert.equal(await call(job,p),reason);assert.deepEqual(await snap(),a);});
  for(const [name,q,reason,preSnapshot] of [
    ['hidden',`insert into dating_1on1_candidate_hides values('${owner}','${incoming[0]}')`,'candidate_excluded'],
    ['favorite',`insert into dating_1on1_candidate_favorites values('${owner}','${incoming[0]}')`,'candidate_excluded'],
    ['member block',`insert into dating_user_blocks values('${incoming[0]}','${owner}')`,'candidate_excluded'],
    ['admin block',`insert into dating_1on1_admin_user_blocks values('${owner}','${incoming[0]}')`,'candidate_excluded'],
    ['phone block after planning',`insert into dating_1on1_phone_blocks values('${owner}',clock_timestamp()+interval '1 minute')`,'candidate_excluded'],
    ['contact block after planning',`insert into dating_contact_blocks values('${incoming[0]}',clock_timestamp()+interval '1 minute')`,'candidate_excluded'],
    ['active request',`insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state) values('${owner}','${incoming[0]}','source_selected')`,'candidate_excluded'],
    ['old skipped request not unseen',`insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state) values('${owner}','${incoming[0]}','source_skipped')`,'candidate_excluded'],
    ['deletion',`update auth.users set deleted_at=now() where id='${incoming[0]}'`,'candidate_unavailable'],
    ['ban',`update profiles set is_banned=true where user_id='${incoming[0]}'`,'candidate_unavailable'],
    ['source ban',`update profiles set is_banned=true where user_id='${owner}'`,'source_unavailable'],
    ['region changed during plan',`update dating_1on1_cards set region='제주' where id='${incoming[0]}'`,'profile_changed'],
    ['phone changed during plan',`update profiles set phone_e164='+821012345678' where user_id='${incoming[0]}'`,'profile_changed'],
    ['age outside range',`update dating_1on1_cards set birth_year=1980 where id='${incoming[0]}'`,'fit_changed',true],
    ['only current views',`update dating_1on1_candidate_impressions set first_seen_at=clock_timestamp()`,'not_repeated'],
    ['old impressions',`update dating_1on1_candidate_impressions set first_seen_at=now()-interval '40 days'`,'not_repeated'],
    ['new browser impression raced',`insert into dating_1on1_candidate_impressions values('${owner}','${incoming[0]}',clock_timestamp())`,'already_seen'],
    ['delivered expansion',`insert into dating_1on1_expansion_batches values('${owner}',current_date,array['${incoming[0]}']::uuid[])`,'already_seen'],
    ['delivered prior page',`insert into dating_1on1_recommendation_page_history values('${owner}',now()-interval '3 days',array['${incoming[0]}']::uuid[],'{}')`,'already_seen'],
    ['manual repair today',`insert into notifications(user_id,type,meta_json) values('${owner}','comment','{"refresh_repair_incident":"manual"}')`,'cooldown'],
    ['disabled',`update dating_1on1_refresh_monitor_settings set mode='off'`,'inactive_job'],
    ['lease changed',`update dating_1on1_refresh_audits set lease_token=gen_random_uuid() where state='running'`,'inactive_job'],
  ])await isolated(name,async()=>{await setting();const {job}=await claim();if(preSnapshot)await db.exec(q);const p=await makePlan();if(!preSnapshot)await db.exec(q);const a=await snap();assert.equal(await call(job,p),reason);assert.deepEqual(await snap(),a);});
  await isolated('claim recent users without new attempt and never claims same leased/done job twice',async()=>{await setting();const first=await claim();assert.equal(first.job.day_key,new Date(Date.now()+9*3600000).toISOString().slice(0,10));assert.equal(await claim(),null);assert.equal(await call(first.job),'repaired');assert.equal(await claim(),null);});
  await isolated('observe plan is claimable once after activation',async()=>{await setting('observe');const {job}=await claim();await db.query("update dating_1on1_refresh_audits set state='done',finding='partial_ready' where id=$1",[job.id]);assert.equal(await claim(),null);await setting();const second=await claim();assert.equal(second.job.id,job.id);assert.notEqual(second.job.lease_token,job.lease_token);});
  await isolated('notice failure rolls back page, history, quota and outbox',async()=>{
    await setting();const {job}=await claim();await db.exec(`create function pg_temp.reject_notice() returns trigger language plpgsql as $$begin raise exception 'notice unavailable';end$$;
    create trigger fail_notice before insert on notifications for each row execute function pg_temp.reject_notice();`);
    const a=await snap();await db.exec('savepoint attempt');await assert.rejects(call(job),/notice unavailable/);await db.exec('rollback to attempt');assert.deepEqual(await snap(),a);
  });
 }finally{await db.close();}
});
