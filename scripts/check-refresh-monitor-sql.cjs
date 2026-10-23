/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require(process.env.REFRESH_TEST_PGLITE_PATH || '@electric-sql/pglite');
const sql = name => fs.readFileSync(path.join(__dirname, '../supabase/sql/' + name + '.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1), source=id(2), other=id(3), candidate=id(4), former=id(5), attempt=id(6);
const key = require('node:crypto').createHash('md5').update('male:1996:서울 강남구').digest('hex');

test('daily refresh monitor SQL: real transactions, permissions, quota and concurrency', async t => {
  const db = new PGlite();
  const rows = async q => (await db.query(q)).rows;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
      insert into auth.users(id) values('${owner}'),('${other}');
      create table profiles(user_id uuid primary key,is_banned boolean);
      insert into profiles values('${owner}',false),('${other}',false);
      create table dating_1on1_cards(id uuid primary key,user_id uuid,sex text,status text,
        recommendation_refresh_used_at timestamptz,updated_at timestamptz,intro_text text,birth_year integer default 1996,region text default '서울 강남구');
      insert into dating_1on1_cards(id,user_id,sex,status,intro_text) values
        ('${source}','${owner}','male','approved','내 소개 원문'),('${candidate}','${other}','female','approved','상대 원문');
      create table dating_1on1_recommendation_refresh_events(id bigint generated always as identity,card_id uuid,user_id uuid,refreshed_at timestamptz);
      create table dating_1on1_plus_subscriptions(user_id uuid,expires_at timestamptz);
      create table dating_1on1_match_proposals(id uuid primary key default gen_random_uuid(),source_user_id uuid,candidate_user_id uuid,state text,contact text);
      create table dating_1on1_candidate_favorites(user_id uuid,candidate_card_id uuid);
      create table dating_user_blocks(blocker_user_id uuid,blocked_user_id uuid);
      create table dating_1on1_admin_user_blocks(user_a_id uuid,user_b_id uuid);
      create table notifications(id uuid primary key default gen_random_uuid(),user_id uuid,type text,meta_json jsonb);
      create table purchases(id uuid primary key,amount integer);
      insert into purchases values('${id(90)}',18000);`);
    for (const file of ['dating_1on1_checked_refresh','dating_1on1_repeat_rotation','dating_1on1_recommendation_pages',
      'dating_1on1_recommendation_page_history','dating_1on1_refresh_monitor','dating_1on1_refresh_monitor']) await db.exec(sql(file));
    const setting = async (mode='repair') => db.query('update dating_1on1_refresh_monitor_settings set mode=$1,email_enabled=true', [mode]);
    const seed = async (outcome='failed') => {
      await db.query(`insert into dating_1on1_refresh_attempts(id,user_id,source_card_id,created_at,expected_refresh_at,
        planned_at,source_profile_key,outcome,persist_page,changed_count,rotated_count,before_candidate_ids,before_user_ids,
        after_user_ids,main_candidate_ids,extra_candidate_ids,pool_count,safe_local_change)
        values($1,$2,$3,clock_timestamp()-interval '1 day',null,clock_timestamp()-interval '1 day',$4,$5,true,1,1,$6::uuid[],$7::uuid[],$8::uuid[],$9::uuid[],'{}',50,true)`,
      [attempt,owner,source,key,outcome,[former],[id(91)],[other],[candidate]]);
      return (await rows('select * from claim_dating_1on1_refresh_audit() j'))[0].j;
    };
    const repair = async (job, overrides={}) => (await db.query('select repair_dating_1on1_refresh_audit($1,$2,$3,$4::uuid[],$5::uuid[],$6) ok',
      [job.id,overrides.token ?? job.lease_token,overrides.at ?? new Date().toISOString(),overrides.main ?? [candidate],overrides.extra ?? [],overrides.key ?? key])).rows[0].ok;
    const snapshot = async () => ({
      cards: await rows('select * from dating_1on1_cards order by id'),
      events: await rows('select card_id,user_id,refreshed_at,quota_refunded_at,rotation_only from dating_1on1_recommendation_refresh_events order by refreshed_at'),
      pages: await rows('select * from dating_1on1_recommendation_pages'), history: await rows('select * from dating_1on1_recommendation_page_history'),
      bonuses: await rows('select * from dating_1on1_refresh_compensations'), notices: await rows('select * from notifications'),
      purchases: await rows('select * from purchases'), matches: await rows('select * from dating_1on1_match_proposals'),
      favorites: await rows('select * from dating_1on1_candidate_favorites'), audits: await rows('select * from dating_1on1_refresh_audits'),
    });
    async function isolated(name, fn) {
      await t.test(name, async () => { await db.exec('begin'); try { await fn(); } finally { await db.exec('rollback'); } });
    }
    await isolated('installed default is observe, no email', async () => {
      assert.deepEqual((await rows('select mode,email_enabled from dating_1on1_refresh_monitor_settings'))[0],{mode:'observe',email_enabled:false});
      const { job } = await seed(); const before=await snapshot(); assert.equal(await repair(job),false); assert.deepEqual(await snapshot(),before);
    });
    await isolated('anonymous/member clients cannot read or mutate monitoring or run privileged functions', async () => {
      const { job } = await seed();
      for (const role of ['anon','authenticated']) {
        await db.exec('savepoint roles'); await db.exec('set local role ' + role);
        await assert.rejects(rows('select * from dating_1on1_refresh_attempts'), /permission denied/); await db.exec('rollback to roles');
        await db.exec('set local role ' + role); await assert.rejects(rows('select claim_dating_1on1_refresh_audit()'),/permission denied/); await db.exec('rollback to roles');
        await db.exec('set local role ' + role); await assert.rejects(repair(job), /permission denied/); await db.exec('rollback to roles');
      }
    });
    await isolated('daily per-member queue is idempotent and keeps latest planned attempt despite delayed telemetry', async () => {
      await seed();
      // Claimed jobs stay immutable; late observations are not allowed to retarget a lease.
      await db.exec(`insert into dating_1on1_refresh_attempts select '${id(70)}',user_id,source_card_id,created_at,
        expected_refresh_at,planned_at-interval '1 hour',source_profile_key,outcome,persist_page,changed_count,rotated_count,
        before_candidate_ids,before_user_ids,after_user_ids,main_candidate_ids,extra_candidate_ids,pool_count,safe_local_change,widened_count,age_mismatch_count
        from dating_1on1_refresh_attempts where id='${attempt}'`);
      assert.equal((await rows('select count(*)::int n from dating_1on1_refresh_audits'))[0].n,1);
      assert.equal((await rows('select attempt_id from dating_1on1_refresh_audits'))[0].attempt_id,attempt);
      assert.equal((await rows('select claim_dating_1on1_refresh_audit() j'))[0].j,null);
    });
    await isolated('newer member attempt prevents background replacement', async () => {
      await setting(); const {job}=await seed();
      await db.exec(`insert into dating_1on1_refresh_attempts select '${id(71)}',user_id,source_card_id,created_at,
        expected_refresh_at,planned_at+interval '1 hour',source_profile_key,outcome,persist_page,changed_count,rotated_count,
        before_candidate_ids,before_user_ids,after_user_ids,main_candidate_ids,extra_candidate_ids,pool_count,safe_local_change,widened_count,age_mismatch_count
        from dating_1on1_refresh_attempts where id='${attempt}'`);
      const before=await snapshot();assert.equal(await repair(job),false);assert.deepEqual(await snapshot(),before);
    });
    await isolated('legacy installation without member blocks safely refuses repair with no changes', async () => {
      await setting(); const {job}=await seed();
      await db.exec('drop table dating_user_blocks');
      const before=await snapshot();
      assert.equal(await repair(job),false);
      assert.deepEqual(await snapshot(),before);
    });
    await isolated('one repair per week and stopping mode are checked inside the transaction', async () => {
      await setting();const {job}=await seed();
      await db.exec(`insert into dating_1on1_refresh_audits(user_id,day_key,attempt_id,state,finding,repaired_at)
        values('${owner}','2001-01-01','${attempt}','done','repaired',clock_timestamp()-interval '1 day')`);
      const before=await snapshot();assert.equal(await repair(job),false);assert.deepEqual(await snapshot(),before);
      await db.exec("delete from dating_1on1_refresh_audits where day_key='2001-01-01'");await setting('off');
      const stopped=await snapshot();assert.equal(await repair(job),false);assert.deepEqual(await snapshot(),stopped);
    });
    await isolated('crashed jobs have bounded retries and are marked for operator review', async () => {
      await seed();await db.exec("update dating_1on1_refresh_audits set lease_until=clock_timestamp()-interval '1 minute',attempts=3");
      assert.equal((await rows('select claim_dating_1on1_refresh_audit() j'))[0].j,null);
      assert.equal((await rows('select finding from dating_1on1_refresh_audits'))[0].finding,'check_failed');
    });
    await isolated('off mode still expires private diagnostics without repairing or notifying', async () => {
      await seed();await setting('off');await db.exec("update dating_1on1_refresh_attempts set created_at=clock_timestamp()-interval '31 days'");
      assert.equal((await rows('select claim_dating_1on1_refresh_audit() j'))[0].j,null);
      assert.equal((await rows('select count(*)::int n from dating_1on1_refresh_attempts'))[0].n,0);
      assert.equal((await rows('select count(*)::int n from notifications'))[0].n,0);
    });
    await isolated('real worker to real SQL: only a committed recovery counts as repaired; replay is empty', async () => {
      await setting();const claimed=await seed();
      await db.exec("update dating_1on1_refresh_audits set state='queued',lease_token=null,lease_until=null");
      const ts=require('typescript'),mod={exports:{}};
      const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../lib/dating-1on1-refresh-monitor.ts'),'utf8'),
        {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
      new Function('require','module','exports','process',code)(name=>{
        if(name==='@/lib/dating-1on1-recommendation-service')return {loadOneOnOneRecommendations:async()=>Response.json({plan:{
          source_card_id:source,source_profile_key:key,expected_refresh_used_at:null,refresh_at:new Date().toISOString(),
          main_candidate_ids:[candidate],extra_candidate_ids:[],persist_page:true,rotated_candidate_count:1,monitor:{safe_local_change:true}}})};
        if(name==='@/lib/dating-1on1-reminders')return{isOneOnOneReminderHour:()=>false};
        if(name==='@/lib/dating-swipe')return{sendDatingEmailNotification:()=>{throw Error('real email forbidden');}};
        throw Error('Unexpected import '+name);
      },mod,mod.exports,{env:{}});
      const admin={from:table=>{assert.equal(table,'dating_1on1_refresh_monitor_settings');
        const q={select:()=>q,eq:()=>q,single:async()=>({data:{mode:'repair'},error:null})};return q;},
        rpc:async(name,p)=>name==='claim_dating_1on1_refresh_audit'?{data:(await rows('select claim_dating_1on1_refresh_audit() j'))[0].j,error:null}
          :{data:await repair({id:p.p_job_id,lease_token:p.p_token},{at:p.p_refresh_at,main:p.p_main,extra:p.p_extra,key:p.p_source_key}),error:null}};
      assert.equal(claimed.attempt.outcome,'failed');
      assert.deepEqual(await mod.exports.runRefreshMonitor(admin),{configured:true,checked:1,sent:0});
      assert.deepEqual(await mod.exports.runRefreshMonitor(admin),{configured:true,checked:0,sent:0});
      assert.equal((await rows('select count(*)::int n from notifications'))[0].n,1);
      assert.equal((await rows('select count(*)::int n from dating_1on1_recommendation_refresh_events where quota_refunded_at is null'))[0].n,0);
    });
    await isolated('repair atomically persists page, free event, readable Korean site alarm and mail outbox', async () => {
      await setting(); const { job }=await seed();
      await db.exec(`insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,used_count,evidence)
        values('${owner}','existing',2,1,'{}');
        insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state,contact) values('${owner}','${id(80)}','mutual_accepted','preserve-contact');
        insert into dating_1on1_candidate_favorites values('${owner}','${id(81)}');`);
      const before=await snapshot(); assert.equal(await repair(job),true); const after=await snapshot();
      assert.deepEqual(after.bonuses,before.bonuses); assert.deepEqual(after.purchases,before.purchases);
      assert.deepEqual(after.matches,before.matches); assert.deepEqual(after.favorites,before.favorites);
      assert.equal(after.cards[0].intro_text,before.cards[0].intro_text);
      assert.equal(after.events.length,1); assert.ok(after.events[0].quota_refunded_at); assert.equal(after.events[0].rotation_only,true);
      assert.deepEqual(after.pages[0].main_candidate_ids,[candidate]); assert.equal(after.history.length,1);
      assert.equal(after.notices.length,1); assert.equal(after.notices[0].meta_json.notification_title,'1:1 후보 새로고침을 복구했어요');
      assert.equal(after.notices[0].meta_json.notification_route,'/community/dating/cards?tab=one_on_one');
      assert.equal(after.audits[0].finding,'repaired'); assert.equal(after.audits[0].email_state,'pending');
      assert.equal(await repair(job),false); assert.deepEqual(await snapshot(),after);
    });
    await isolated('quota-exhausted normal/Plus uses and compensation remain unchanged', async () => {
      await setting(); const { job }=await seed();
      await db.exec(`update dating_1on1_cards set recommendation_refresh_used_at=clock_timestamp()-interval '1 hour' where id='${source}';
        update dating_1on1_refresh_attempts set expected_refresh_at=(select recommendation_refresh_used_at from dating_1on1_cards where id='${source}');
        insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
          select id,user_id,recommendation_refresh_used_at from dating_1on1_cards where id='${source}';
        insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at) values('${source}','${owner}',clock_timestamp()-interval '2 hours');`);
      const chargedBefore=await rows('select * from dating_1on1_recommendation_refresh_events where quota_refunded_at is null order by id');
      assert.equal(await repair(job),true);
      assert.deepEqual(await rows('select * from dating_1on1_recommendation_refresh_events where quota_refunded_at is null order by id'),chargedBefore);
    });
    await isolated('legacy charged use preserved instead of accidentally granting extra allowance', async () => {
      await setting(); const { job }=await seed();
      await db.exec(`update dating_1on1_cards set recommendation_refresh_used_at=clock_timestamp()-interval '1 hour' where id='${source}';
        update dating_1on1_refresh_attempts set expected_refresh_at=(select recommendation_refresh_used_at from dating_1on1_cards where id='${source}');`);
      const prior=(await rows(`select recommendation_refresh_used_at t from dating_1on1_cards where id='${source}'`))[0].t;
      assert.equal(await repair(job),true);
      const charge=await rows('select refreshed_at from dating_1on1_recommendation_refresh_events where quota_refunded_at is null');
      assert.equal(charge.length,1); assert.equal(charge[0].refreshed_at.getTime(),prior.getTime());
    });
    for (const [name, change, overrides] of [
      ['normal no-change is not a confirmed error', `update dating_1on1_refresh_attempts set outcome='unchanged'`],
      ['quota limit never bypassed as an error', `update dating_1on1_refresh_attempts set outcome='limited'`],
      ['old incident requires manual review', `update dating_1on1_refresh_attempts set created_at=clock_timestamp()-interval '3 days'`],
      ['old source key', '', {key:'bad'}], ['wrong lease token','',{token:id(88)}], ['expired lease',`update dating_1on1_refresh_audits set lease_until=clock_timestamp()-interval '1 second'`],
      ['source refresh changed',`update dating_1on1_cards set recommendation_refresh_used_at=clock_timestamp() where id='${source}'`],
      ['source edited',`update dating_1on1_cards set region='부산' where id='${source}'`],
      ['candidate ban',`update profiles set is_banned=true where user_id='${other}'`],
      ['source ban',`update profiles set is_banned=true where user_id='${owner}'`],
      ['withdrawal',`update auth.users set deleted_at=clock_timestamp() where id='${owner}'`],
      ['auth ban',`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='${other}'`],
      ['hidden candidate',`update dating_1on1_cards set status='rejected' where id='${candidate}'`],
      ['sent request preserved',`insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state) values('${owner}','${other}','source_selected')`],
      ['rejected pair',`insert into dating_1on1_match_proposals(source_user_id,candidate_user_id,state) values('${other}','${owner}','candidate_rejected')`],
      ['favorite',`insert into dating_1on1_candidate_favorites values('${owner}','${candidate}')`],
      ['member block',`insert into dating_user_blocks values('${other}','${owner}')`],
      ['admin block',`insert into dating_1on1_admin_user_blocks values('${owner}','${other}')`],
      ['empty page','',{main:[]}], ['duplicate identities','',{main:[candidate,candidate]}], ['null id','',{main:[null]}],
      ['too many mains','',{main:Array(11).fill(candidate)}], ['overlap extras','',{extra:[candidate]}],
      ['stale plan time','',{at:new Date(Date.now()-300000).toISOString()}],
    ]) await isolated(name, async () => {
      await setting(); const { job }=await seed(); if(change) await db.exec(change);
      const before=await snapshot(); assert.equal(await repair(job,overrides),false); assert.deepEqual(await snapshot(),before);
    });
    for (const table of ['notifications','dating_1on1_recommendation_pages','dating_1on1_recommendation_page_history'])
      await isolated(`${table} failure rolls back seed/page/free event/outbox together`, async () => {
        await setting(); const { job }=await seed();
        await db.exec(`create function fixture_fail() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end $$;
          create trigger fixture_fail before insert on ${table} for each row execute function fixture_fail();`);
        const before=await snapshot(); await db.exec('savepoint failed_write'); await assert.rejects(repair(job),/synthetic failure/);
        await db.exec('rollback to failed_write'); assert.deepEqual(await snapshot(),before);
      });
    await isolated('two workers cannot repair same incident twice', async () => {
      await setting(); const { job }=await seed(); const outcomes=await Promise.all([repair(job),repair(job)]);
      assert.equal(outcomes.filter(Boolean).length,1); assert.equal((await rows('select count(*)::int n from notifications'))[0].n,1);
    });
    await isolated('deleted account removes private diagnostic records', async () => {
      await seed(); await db.exec(`delete from auth.users where id='${owner}'`);
      assert.equal((await rows('select count(*)::int n from dating_1on1_refresh_attempts'))[0].n,0);
      assert.equal((await rows('select count(*)::int n from dating_1on1_refresh_audits'))[0].n,0);
    });
  } finally { await db.close(); }
});
