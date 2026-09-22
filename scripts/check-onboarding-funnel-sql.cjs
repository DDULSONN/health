/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PRIVACY_TEST_PGLITE_PATH || '@electric-sql/pglite');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/sql/onboarding_funnel.sql'), 'utf8');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, created_at timestamptz default now(), deleted_at timestamptz);
      create table public.profiles(user_id uuid primary key references auth.users(id) on delete cascade,
        role text default 'user', phone_verified boolean default false);
      create table public.dating_cards(id int, owner_user_id uuid);
      create table public.dating_1on1_cards(id int, user_id uuid);
      create table public.dating_1on1_match_proposals(id int, source_user_id uuid, candidate_user_id uuid, state text, contact_exchange_status text);`);
    for (let n = 1; n <= 8; n++) {
      await db.query('insert into auth.users(id) values($1)', [id(n)]);
      await db.query('insert into profiles(user_id,phone_verified) values($1,$2)', [id(n), n <= 4]);
    }
    await db.query("update profiles set role='admin' where user_id=$1", [id(6)]);
    await db.query('update auth.users set deleted_at=now() where id=$1', [id(7)]);
    await db.query("update auth.users set created_at=now()-interval '31 days' where id=$1", [id(8)]);
    await db.query('insert into dating_cards values(1,$1),(2,$1)', [id(2)]);
    await db.query('insert into dating_1on1_cards values(1,$1),(2,$2),(3,$2)', [id(3), id(4)]);
    await db.query("insert into dating_1on1_match_proposals values(1,$1,$2,'mutual_accepted','approved'),(2,$1,$2,'mutual_accepted','none')", [id(3), id(4)]);
    const snapshot = async () => (await db.query("select jsonb_build_object('profiles',(select jsonb_agg(p) from profiles p),'matches',(select jsonb_agg(m) from dating_1on1_match_proposals m),'cards',(select jsonb_agg(c) from dating_cards c)) as value")).rows[0].value;
    const before = await snapshot();
    await db.exec(sql);
    const since = (await db.query('select tracking_since from onboarding_funnel_config')).rows[0].tracking_since;
    await db.exec(sql);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await db.query('select tracking_since from onboarding_funnel_config')).rows[0].tracking_since, since);
    console.log('PASS: repeatable migration preserves all existing data and original collection start');
    const repair = fs.readFileSync(path.join(__dirname, '../supabase/sql/onboarding_funnel_owner_column_fix.sql'), 'utf8');
    const metadata = async () => (await db.query("select to_jsonb(p) as value from pg_proc p where oid='public.admin_onboarding_funnel_summary(integer)'::regprocedure")).rows[0].value;
    const correctMetadata = await metadata();
    const correctDefinition = (await db.query("select pg_get_functiondef('public.admin_onboarding_funnel_summary(integer)'::regprocedure) as value")).rows[0].value;
    await db.exec(correctDefinition.replace('public.dating_cards c where c.owner_user_id = p.user_id', 'public.dating_cards c where c.user_id = p.user_id'));
    await assert.rejects(db.query('select admin_onboarding_funnel_summary(7)'), /column c.user_id does not exist/);
    await db.exec(repair);
    await db.exec(repair);
    assert.deepEqual(await metadata(), correctMetadata, 'repair preserves every function property including ACL/owner/security and only restores the known body');
    assert.deepEqual(await snapshot(), before);
    await db.exec(correctDefinition.replace('return v_result;', "return v_result; -- unexpected edit"));
    await assert.rejects(db.exec(repair), /Unexpected diagnostic function version/);
    await db.exec('rollback');
    await db.exec(correctDefinition);
    console.log('PASS: early owner-column correction is guarded, repeatable, data/ACL/security preserving, and refuses unknown versions');
    await db.exec('set role service_role');
    for (const n of [1, 2, 5]) await db.query("insert into onboarding_funnel_events(user_id,event_name) values($1,'profile_basic') on conflict do nothing", [id(n)]);
    await db.query("insert into onboarding_funnel_events(user_id,event_name) values($1,'profile_basic') on conflict do nothing", [id(1)]);
    await db.query("insert into onboarding_funnel_events(user_id,event_name) values($1,'photo_rejected')", [id(1)]);
    const result = (await db.query('select admin_onboarding_funnel_summary(7) as value')).rows[0].value;
    assert.deepEqual(result.counts, { joined: 5, verified: 4, profile: 3, one_on_one: 2, mutual: 2, exchanged: 2 });
    assert.deepEqual(result.events, { profile_basic: 3, photo_rejected: 1 });
    assert.deepEqual(result.unregistered, { profile_basic: 2, photo_rejected: 1 });
    assert.ok(!JSON.stringify(result).includes(id(1)));
    assert.equal(new Date(result.cohort_start).getUTCHours(), 15);
    console.log('PASS: actual signup cohort, KST boundaries, both match participants, distinct members and no raw identities');
    for (const days of [0, 2, 31, null]) await assert.rejects(db.query('select admin_onboarding_funnel_summary($1)', [days]), /unsupported period/);
    await assert.rejects(db.query("insert into onboarding_funnel_events(user_id,event_name) values($1,'secret@example.invalid')", [id(1)]), /check constraint/);
    await assert.rejects(db.query("update onboarding_funnel_events set first_seen_at=now()"), /permission denied/);
    await db.exec('reset role');
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(db.query('select admin_onboarding_funnel_summary(7)'), /permission denied/);
      await assert.rejects(db.query('select * from onboarding_funnel_events'), /permission denied/);
      await assert.rejects(db.query("insert into onboarding_funnel_events(user_id,event_name) values($1,'phone_view')", [id(1)]), /permission denied/);
      await db.exec('reset role');
    }
    console.log('PASS: client roles denied table/function access, fixed codes, no timestamp rewriting');
    await db.query('delete from profiles where user_id=$1', [id(1)]);
    assert.equal((await db.query('select count(*)::int as n from onboarding_funnel_events where user_id=$1', [id(1)])).rows[0].n, 0);
    await db.exec("update dating_1on1_match_proposals set state='admin_canceled'");
    const changed = (await db.query('select admin_onboarding_funnel_summary(30) as value')).rows[0].value;
    assert.equal(changed.counts.mutual, 0); assert.equal(changed.counts.exchanged, 0);
    console.log('PASS: profile deletion cascades diagnostics and canceled matches no longer inflate current completion');
    await db.exec('delete from profiles');
    const empty = (await db.query('select admin_onboarding_funnel_summary(1) as value')).rows[0].value;
    assert.equal(empty.counts.joined, 0); assert.deepEqual(empty.events, {});
    console.log('PASS: empty cohort returns valid zero counts, not invalid percentages');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
