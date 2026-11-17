/* eslint-disable @typescript-eslint/no-require-imports */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),source=id(2),before=[id(10),id(11),id(12)],after=[id(20),id(21),id(22)];
const key=require('node:crypto').createHash('md5').update('male:1996:서울').digest('hex');
const sql=n=>fs.readFileSync(path.join(__dirname,'../supabase/sql/'+n+'.sql'),'utf8');
test('operator candidate repair is isolated, atomic, idempotent and quota-neutral',async t=>{
 const db=new PGlite();const rows=async(q,p)=>(await db.query(q,p)).rows;
 try{
  await db.exec(`create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
   create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
   create table profiles(user_id uuid primary key,is_banned boolean default false);
   create table dating_1on1_cards(id uuid primary key,user_id uuid,sex text,status text,birth_year integer,region text,
     recommendation_refresh_used_at timestamptz,updated_at timestamptz,intro_text text);
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
   create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,meta_json jsonb);
   create table purchases(id uuid primary key,amount integer); insert into purchases values('${id(90)}',18000);
   create table dating_1on1_refresh_compensations(user_id uuid,granted_count integer,used_count integer);
   insert into dating_1on1_refresh_compensations values('${owner}',2,1);
   insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state,contact) values('${owner}','${id(99)}','mutual_accepted','unchanged-contact');`);
  for(const uid of [owner,...before,...after]){await db.query('insert into auth.users(id) values($1)',[uid]);await db.query('insert into profiles(user_id) values($1)',[uid]);}
  const stamp=new Date(Date.now()-3600000).toISOString();
  await db.query(`insert into dating_1on1_cards values($1,$2,'male','approved',1996,'서울',$3,$3,'untouched')`,[source,owner,stamp]);
  for(const uid of [...before,...after])await db.query(`insert into dating_1on1_cards values($1,$1,'female','approved',1998,'서울',null,null,'untouched')`,[uid]);
  await db.query('insert into dating_1on1_recommendation_pages values($1,$2,$3,$4,$5,$6)',[owner,source,stamp,key,before.slice(0,2),before.slice(2)]);
  await db.exec(sql('dating_1on1_recommendation_page_history'));
  await db.exec(sql('dating_1on1_operator_page_repair'));
  const params=()=>[owner,source,stamp,key,before.slice(0,2),before.slice(2),after.slice(0,2),after.slice(2),new Date().toISOString(),'regional-repeat-20261117'];
  const call=async(p=params())=>(await rows('select pg_temp.repair_dating_1on1_page($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7::uuid[],$8::uuid[],$9,$10) result',p))[0].result;
  const snap=async()=>{const out={};for(const table of ['dating_1on1_cards','dating_1on1_recommendation_pages','dating_1on1_recommendation_page_history','dating_1on1_recommendation_refresh_events','dating_1on1_match_proposals','purchases','dating_1on1_refresh_compensations','notifications'])out[table]=await rows('select * from '+table+' order by 1');return out;};
  const isolated=async(name,fn)=>t.test(name,async()=>{await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}});
  await isolated('no permanent RPC or privilege expansion',async()=>{const [f]=await rows("select prosecdef,has_function_privilege('anon',oid,'EXECUTE') allowed from pg_proc where proname='repair_dating_1on1_page'");assert.deepEqual(f,{prosecdef:false,allowed:false});});
  await isolated('legacy use remains charged; repair and its notification happen once',async()=>{
   const a=await snap();assert.equal(await call(),'repaired');const b=await snap();
   for(const table of ['dating_1on1_match_proposals','purchases','dating_1on1_refresh_compensations'])assert.deepEqual(b[table],a[table]);
   assert.equal(b.dating_1on1_recommendation_refresh_events.filter(e=>e.quota_refunded_at===null).length,1);
   assert.equal(b.dating_1on1_recommendation_refresh_events.filter(e=>e.rotation_only&&e.quota_refunded_at).length,1);
   assert.equal(b.dating_1on1_recommendation_page_history.length,2);
   assert.deepEqual(b.dating_1on1_recommendation_pages[0].main_candidate_ids,after.slice(0,2));
   assert.equal(b.notifications.length,1);assert.equal(b.notifications[0].meta_json.notification_route,'/community/dating/cards?tab=one_on_one');
   assert.equal(await call(),'already_repaired');assert.deepEqual(await snap(),b);
  });
  for(const charged of [0,1,2])await isolated(`existing ${charged} charged events and bonus count unchanged`,async()=>{
   for(let i=0;i<Math.max(1,charged);i++)await db.query(`insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at,quota_refunded_at,rotation_only) values($1,$2,$3,$4,$5)`,[source,owner,new Date(Date.parse(stamp)-i*1000).toISOString(),charged?null:stamp,!charged]);
   const a=await snap();assert.equal(await call(),'repaired');const b=await snap();assert.equal(b.dating_1on1_recommendation_refresh_events.filter(e=>!e.quota_refunded_at).length,charged);assert.deepEqual(b.dating_1on1_refresh_compensations,a.dating_1on1_refresh_compensations);
  });
  for(const [name,index,value,reason] of [
   ['different owner',0,id(99),'stale_plan'],['changed seed',2,new Date().toISOString(),'stale_plan'],
   ['changed profile',3,'wrong','stale_plan'],['changed page',4,after.slice(0,2),'stale_plan'],
   ['stale plan',8,new Date(Date.now()-600000).toISOString(),'stale_plan'],['unknown incident',9,'other','invalid_incident'],
   ['duplicate IDs',6,[after[0],after[0]],'invalid_page'],['short page',6,[],'invalid_page']
  ])await isolated(name,async()=>{const p=params();p[index]=value;const a=await snap();assert.equal(await call(p),reason);assert.deepEqual(await snap(),a);});
  for(const [name,q,reason] of [
   ['hidden',`insert into dating_1on1_candidate_hides values('${owner}','${after[0]}')`,'candidate_excluded'],
   ['favorite',`insert into dating_1on1_candidate_favorites values('${owner}','${after[0]}')`,'candidate_excluded'],
   ['member block',`insert into dating_user_blocks values('${after[0]}','${owner}')`,'candidate_excluded'],
   ['admin block',`insert into dating_1on1_admin_user_blocks values('${owner}','${after[0]}')`,'candidate_excluded'],
   ['new phone block',`insert into dating_1on1_phone_blocks values('${after[0]}',clock_timestamp()+interval '1 minute')`,'candidate_excluded'],
   ['active request',`insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state) values('${owner}','${after[0]}','source_selected')`,'candidate_excluded'],
   ['rejection',`insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state) values('${owner}','${after[0]}','candidate_rejected')`,'candidate_excluded'],
   ['withdrawn',`update auth.users set deleted_at=now() where id='${after[0]}'`,'candidate_unavailable'],
   ['banned',`update profiles set is_banned=true where user_id='${after[0]}'`,'candidate_unavailable'],
   ['underage',`update dating_1on1_cards set birth_year=extract(year from now())::int-18 where id='${after[0]}'`,'candidate_unavailable'],
   ['source inactive',`update dating_1on1_cards set status='rejected' where id='${source}'`,'stale_plan']
  ])await isolated(name,async()=>{await db.exec(q);const a=await snap();assert.equal(await call(),reason);assert.deepEqual(await snap(),a);});
  await isolated('notification failure rolls back page, history, seed and free event',async()=>{
   await db.exec(`create function pg_temp.reject_notice() returns trigger language plpgsql as $$begin raise exception 'notice unavailable';end$$;
    create trigger fail_notice before insert on notifications for each row execute function pg_temp.reject_notice();`);
   const a=await snap();await db.exec('savepoint attempt');await assert.rejects(call(),/notice unavailable/);await db.exec('rollback to attempt');assert.deepEqual(await snap(),a);
  });
 }finally{await db.close();}
});
