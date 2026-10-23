// Run after npm ci. Uses the project's pinned PGlite dev dependency.
// Isolated in-memory PostgreSQL only; never connects to production.
const { PGlite } = require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..');
const db=new PGlite();let checks=0;
function eq(a,b,message){assert.deepEqual(a,b,message);checks++;}
async function rows(sql,params=[]){return (await db.query(sql,params)).rows;}
async function scalar(sql,params=[]){return Object.values((await rows(sql,params))[0])[0];}
const u='11111111-1111-4111-8111-111111111111',admin='22222222-2222-4222-8222-222222222222';
const card='33333333-3333-4333-8333-333333333333',open='44444444-4444-4444-8444-444444444444';
const good={suspicionLevel:'clear',flags:[],photoFlags:[],textFlags:[],summary:'정상',raw:{provider:'gemini',incomplete:[]}};
async function job(source='one_on_one',id=card){return (await rows('select * from dating_profile_review_jobs where source_type=$1 and card_id=$2',[source,id]))[0];}
async function claim(){return rows('select * from claim_dating_profile_reviews(4)');}
async function finish(j,result=good,failure=null){return scalar('select finish_dating_profile_review($1,$2,$3,$4,$5,$6)',[j.source_type,j.card_id,j.revision,j.lease_token,result,failure]);}
async function resolve(j,action){return rows('select resolve_dating_profile_review($1,$2,$3,$4,$5)',[j.source_type,j.card_id,j.revision,action,admin]);}
(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(user_id uuid primary key,role text,is_banned boolean default false,banned_reason text,banned_at timestamptz);
    create table dating_cards(id uuid primary key,owner_user_id uuid,status text,display_nickname text,age int,region text,job text,ideal_type text,strengths_text text,instagram_id text,photo_paths jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),expires_at timestamptz);
    create table dating_1on1_cards(id uuid primary key,user_id uuid,status text,name text,birth_year int,region text,job text,intro_text text,strengths_text text,preferred_partner_text text,photo_paths jsonb,created_at timestamptz default now(),updated_at timestamptz default now(),reviewed_at timestamptz,reviewed_by_user_id uuid);
    create table dating_paid_cards(id uuid primary key,user_id uuid,status text,expires_at timestamptz);
    insert into profiles values('${u}','user',false,null,null),('${admin}','admin',false,null,null);`);
  await db.exec(fs.readFileSync(root+'/supabase/sql/dating_profile_auto_review.sql','utf8'));
  // A unified registration (two writes) and individual registration use the same trigger.
  await db.exec(`begin;
    insert into dating_1on1_cards(id,user_id,status,name,birth_year,intro_text,photo_paths) values('${card}','${u}','submitted','테스트',2008,'외부 연락처 등 검수 대상','["a","b"]');
    insert into dating_cards(id,owner_user_id,status,display_nickname,photo_paths) values('${open}','${u}','pending','test','["a","b"]'); commit;`);
  eq(await scalar('select count(*)::int from dating_profile_review_jobs'),2,'both registrations queued');
  eq(await scalar('select is_banned from profiles where user_id=$1',[u]),false,'registration never bans');
  const first=await job();
  await db.exec(`update dating_1on1_cards set status='reviewing' where id='${card}'`);
  eq((await job()).revision,first.revision,'status-only updates do not requeue');
  const batch=await claim(); eq(batch.length,2,'claim both');eq((await claim()).length,0,'claimed jobs not duplicated');
  eq(await finish(batch.find(j=>j.card_id===open)),true,'normal completion');
  await db.exec(`update dating_1on1_cards set intro_text='새 글' where id='${card}'`);
  eq(await finish(batch.find(j=>j.card_id===card)),false,'stale model output discarded');
  eq((await job()).state,'queued','changed content queued');
  let j=(await claim())[0];eq(await finish(j),true,'new revision completes');
  await resolve(await job(),'clear');eq((await job()).resolution,'cleared','human clearance persisted');
  await db.exec('select reconcile_dating_profile_reviews()');eq((await job()).resolution,'cleared','reconciliation preserves human decision');
  await db.exec(`update dating_1on1_cards set photo_paths='["c","d"]' where id='${card}'`);
  eq((await job()).resolution,'open','new photos reopen clearance');
  await assert.rejects(()=>resolve(first,'ban'),/review changed/);checks++;
  eq(await scalar('select is_banned from profiles where user_id=$1',[u]),false,'stale action cannot ban');
  for(let n=1;n<=3;n++){
    await db.exec(`update dating_profile_review_jobs set available_at=now()-interval '1 second' where card_id='${card}'`);
    j=(await claim()).find(x=>x.card_id===card);await finish(j,null,'AI unavailable');
    eq((await job()).state,n===3?'failed':'queued','bounded retries');
  }
  eq(await scalar('select count(*)::int from dating_1on1_cards'),1,'failures never delete profiles');
  await resolve(await job(),'retry');eq((await job()).attempts,0,'explicit retry resets attempts');
  j=(await claim())[0];await db.exec(`update dating_profile_review_jobs set lease_until=now()-interval '1 second' where card_id='${card}'`);
  const reclaimed=(await claim())[0];eq(await finish(j),false,'expired lease token cannot complete');eq(await finish(reclaimed),true,'new lease token completes');
  // Simulate queue storage outage; source registration still succeeds and reconciliation repairs it.
  const awaitJobSnapshot=await job();
  await db.exec('alter table dating_profile_review_jobs rename to temporarily_unavailable_jobs');
  await db.exec(`update dating_1on1_cards set intro_text='저장 우선' where id='${card}'`);
  eq(await scalar('select intro_text from dating_1on1_cards where id=$1',[card]),'저장 우선','queue outage does not block registration');
  await db.exec('alter table temporarily_unavailable_jobs rename to dating_profile_review_jobs');
  await assert.rejects(()=>resolve(awaitJobSnapshot,'ban'),/review changed/);checks++;
  await db.exec('select reconcile_dating_profile_reviews()');
  eq((await job()).state,'queued','reconciliation repairs outage');
  await finish((await claim())[0]);
  await resolve(await job(),'ban');
  eq(await scalar('select is_banned from profiles where user_id=$1',[u]),true,'explicit ban only');
  eq(await scalar('select status from dating_1on1_cards where id=$1',[card]),'rejected','ban closes one-on-one');
  eq(await scalar('select status from dating_cards where id=$1',[open]),'hidden','ban hides open card');
  await resolve(await job('open_card',open),'delete');eq(await scalar('select count(*)::int from dating_cards'),0,'explicit card deletion');
  eq((await job('open_card',open)).resolution,'deleted','deletion remains auditable');
  eq(await scalar(`select has_function_privilege('authenticated','resolve_dating_profile_review(text,uuid,uuid,text,uuid)','execute')`),false,'client cannot resolve directly');
  eq(await scalar(`select has_table_privilege('anon','dating_profile_review_jobs','select')`),false,'private queue');
  eq((await scalar("select proconfig from pg_proc where proname='capture_dating_profile_review'")).includes('lock_timeout=100ms'),true,'queue locks cannot indefinitely hold registration');
  // Production open cards have no updated_at: missed edits of old cards still recover.
  await db.exec(`alter table dating_cards drop column updated_at;
    insert into dating_cards(id,owner_user_id,status,display_nickname,created_at) values('${open}','${u}','pending','before',now()-interval '1 year');
    update dating_profile_review_settings set initial_open_card_payloads=jsonb_build_object('${open}',md5(dating_profile_review_payload('open_card',(select to_jsonb(d) from dating_cards d where id='${open}'))::text));
    delete from dating_profile_review_jobs where card_id='${open}'; select reconcile_dating_profile_reviews();`);
  eq(await scalar("select count(*)::int from dating_profile_review_jobs where card_id=$1",[open]),0,'unchanged historical card is not backfilled');
  await db.exec(`alter table dating_profile_review_jobs rename to temporarily_unavailable_jobs;
    update dating_cards set display_nickname='changed during outage' where id='${open}';
    alter table temporarily_unavailable_jobs rename to dating_profile_review_jobs; select reconcile_dating_profile_reviews();`);
  eq((await job('open_card',open)).payload.name,'changed during outage','missed historical open-card edit recovered without updated_at');
  const cache={};function load(name){if(cache[name])return cache[name];const exports={};const js=ts.transpileModule(fs.readFileSync(root+'/lib/'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(js,{exports,require:p=>load(p.replace('./',''))});cache[name]=exports;return exports;}
  const policy=load('dating-auto-review-policy');eq(policy.reviewFailure(good),null,'successful AI accepted');
  eq(typeof policy.reviewFailure({...good,raw:{provider:'rules_fallback'}}),'string','fallback is not a successful AI scan');
  eq(policy.addRegistrationReviewFlags(good,'one_on_one',{birthYear:2008},2026).suspicionLevel,'medium','underage registration flags without action');
  eq(policy.addRegistrationReviewFlags(good,'one_on_one',{birthYear:2007},2026).flags[0].includes('생일'),true,'boundary year does not assert minority');
  console.log(`PASS: ${checks} isolated PostgreSQL / review policy checks`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
