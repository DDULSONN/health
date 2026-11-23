/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.resolve(__dirname, '../supabase/sql/dating_1on1_single_candidate_swaps.sql'), 'utf8');
const signature = 'commit_dating_1on1_single_candidate_swap(uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,timestamptz)';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const generation = 'a'.repeat(64);
const viewer = id(1), source = id(2), fromUser = id(3), fromCard = id(4), toUser = id(5), toCard = id(6);
const altUser = id(7), altCard = id(8), from2User = id(9), from2Card = id(10), otherUser = id(11), otherSource = id(12);

test('single candidate swap is an isolated, generation-scoped overlay', async t => {
  const db = new PGlite();
  const rows = async (query, args) => (await db.query(query, args)).rows;
  const pageAt = new Date(Date.now() - 3600000).toISOString();
  const insertCard = (card, user, sex = 'female') => db.query(
    "insert into dating_1on1_cards(id,user_id,sex,status,birth_year) values($1,$2,$3,'approved',1997)",
    [card, user, sex],
  );
  const stamp = () => new Date().toISOString();
  const commit = async opts => {
    const input = { user: viewer, source, generation, pageAt, expected: pageAt, from: fromCard, to: toCard, planned: stamp(), ...opts };
    return (await rows('select commit_dating_1on1_single_candidate_swap($1,$2,$3,$4,$5,$6,$7,$8) result', Object.values(input)))[0].result;
  };
  const swaps = () => rows('select * from dating_1on1_single_candidate_swaps order by user_id,from_candidate_card_id');
  function trial(name, fn) {
    return t.test(name, async () => {
      await db.exec('begin');
      try { await fn(); } finally { await db.exec('rollback'); }
    });
  }
  try {
    await db.exec(`
      create schema auth;
      create role anon; create role authenticated; create role service_role bypassrls;
      create table auth.users (id uuid primary key, deleted_at timestamptz, banned_until timestamptz);
      create table profiles (user_id uuid primary key, is_banned boolean not null default false);
      create table dating_1on1_cards (
        id uuid primary key, user_id uuid not null, sex text not null, status text not null, birth_year int not null,
        recommendation_refresh_used_at timestamptz, created_at timestamptz not null default now() - interval '60 days',
        updated_at timestamptz not null default now() - interval '60 days'
      );
      create table dating_1on1_recommendation_pages (
        user_id uuid primary key, source_card_id uuid, refreshed_at timestamptz, main_candidate_ids uuid[], extra_candidate_ids uuid[]
      );
      create table dating_1on1_candidate_impressions (viewer_user_id uuid, candidate_user_id uuid, first_seen_at timestamptz);
      create table dating_1on1_candidate_hides (user_id uuid, candidate_user_id uuid);
      create table dating_1on1_candidate_favorites (user_id uuid, candidate_card_id uuid);
      create table dating_1on1_match_proposals (source_user_id uuid, candidate_user_id uuid, state text, exchange text);
      create table dating_user_blocks (blocker_user_id uuid, blocked_user_id uuid);
      create table dating_1on1_admin_user_blocks (user_a_id uuid, user_b_id uuid);
      create table dating_1on1_phone_blocks (user_id uuid, created_at timestamptz);
      create table dating_contact_blocks (user_id uuid, created_at timestamptz);
      create table dating_1on1_recommendation_refresh_events (user_id uuid, card_id uuid, refreshed_at timestamptz, quota_refunded_at timestamptz);
      create table dating_1on1_refresh_compensations (user_id uuid, granted_count int, used_count int);
      create table payments (user_id uuid, amount int);
      create table notifications (user_id uuid, title text);
    `);
    for (const user of [viewer, fromUser, toUser, altUser, from2User, otherUser]) {
      await db.query('insert into auth.users(id) values($1)', [user]);
      await db.query('insert into profiles(user_id) values($1)', [user]);
    }
    for (const [card, user, sex] of [[source, viewer, 'male'], [fromCard, fromUser], [toCard, toUser],
      [altCard, altUser], [from2Card, from2User], [otherSource, otherUser, 'male']]) await insertCard(card, user, sex);
    await db.query('update dating_1on1_cards set recommendation_refresh_used_at=$1 where id=$2', [pageAt, source]);
    await db.query('insert into dating_1on1_recommendation_pages values($1,$2,$3,$4,$5)', [viewer, source, pageAt, [fromCard, from2Card], []]);
    await db.query("insert into dating_1on1_candidate_impressions values($1,$2,now()-interval '2 days'),($1,$3,now()-interval '3 days')", [viewer, fromUser, from2User]);
    await db.query('insert into dating_1on1_recommendation_refresh_events values($1,$2,$3,null)', [viewer, source, pageAt]);
    await db.query('insert into dating_1on1_refresh_compensations values($1,2,1)', [viewer]);
    await db.query("insert into dating_1on1_match_proposals values($1,$2,'mutual_accepted','existing-match')", [viewer, otherUser]);
    await db.query('insert into payments values($1,18000)', [viewer]);
    await db.query("insert into notifications values($1,'old notification')", [viewer]);
    await db.exec(migration);
    await db.exec(migration);

    await trial('member and guest receive neither table nor function permissions; service role has read+RPC only', async () => {
      for (const [role, expected] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
        const [allowed] = await rows("select has_table_privilege($1,'dating_1on1_single_candidate_swaps','select') as sel, has_table_privilege($1,'dating_1on1_single_candidate_swaps','insert,update,delete') as write, has_function_privilege($1,$2,'execute') as execute", [role, signature]);
        assert.deepEqual(allowed, {sel: expected, write: false, execute: expected});
      }
    });
    await trial('service commit changes no base page, quota, match, notification, or payment data', async () => {
      const tables = ['dating_1on1_cards','dating_1on1_recommendation_pages','dating_1on1_recommendation_refresh_events',
        'dating_1on1_refresh_compensations','dating_1on1_match_proposals','payments','notifications'];
      const snapshot = () => Promise.all(tables.map(table => rows(`select * from ${table} order by 1`)));
      const before = await snapshot();
      await db.exec('set local role service_role');
      assert.deepEqual(await commit(), {ok: true, code: 'swapped'});
      assert.deepEqual(await commit(), {ok: true, code: 'already_swapped'});
      assert.deepEqual(await commit({to: altCard}), {ok: false, code: 'slot_already_swapped'});
      assert.deepEqual(await commit({from: from2Card}), {ok: false, code: 'already_seen'});
      await db.exec('reset role');
      assert.deepEqual(await snapshot(), before);
      const [swap] = await swaps();
      const {created_at, ...record} = swap;
      assert.ok(created_at instanceof Date);
      assert.deepEqual(record, {user_id: viewer, source_card_id: source, generation_key: generation,
        from_candidate_card_id: fromCard,to_candidate_card_id: toCard,to_candidate_user_id: toUser});
      assert.equal((await swaps()).length, 1);
    });
    await trial('initial day generation works before any paid/ordinary refresh seed exists', async () => {
      await db.query('delete from dating_1on1_recommendation_pages where user_id=$1',[viewer]);
      await db.query('update dating_1on1_cards set recommendation_refresh_used_at=null where id=$1',[source]);
      assert.deepEqual(await commit({expected: null}), {ok: true, code: 'swapped'});
      assert.equal((await rows('select recommendation_refresh_used_at stamp from dating_1on1_cards where id=$1',[source]))[0].stamp,null);
    });
    await trial('daily guard allows exact retry after cap, rejects further writes, and ignores >24h old metadata', async () => {
      assert.equal((await commit()).code, 'swapped');
      for (let i=0;i<9;i++) await db.query(`insert into dating_1on1_single_candidate_swaps values($1,$2,$3,$4,$5,$6,now())`,
        [viewer,source,generation,id(100+i),id(200+i),toUser]);
      assert.equal((await commit()).code,'already_swapped');
      assert.deepEqual(await commit({from: from2Card,to: altCard}),{ok:false,code:'swap_limit'});
      await db.query("update dating_1on1_single_candidate_swaps set created_at=now()-interval '25 hours' where from_candidate_card_id=$1",[id(100)]);
      assert.equal((await commit({from: from2Card,to: altCard})).code,'swapped');
      assert.equal((await swaps()).length,11);
    });
    await trial('old replacement no longer damps other generations past 30 days', async () => {
      await db.query("insert into dating_1on1_single_candidate_swaps values($1,$2,$3,$4,$5,$6,now()-interval '35 days')",
        [viewer,source,'b'.repeat(64),from2Card,toCard,toUser]);
      assert.equal((await commit()).code,'swapped');
    });
    await trial('failed authentication or invalid request cannot write', async () => {
      assert.equal((await commit({user: otherUser})).code,'source_unavailable');
      assert.equal((await commit({generation: 'bad'})).code,'invalid_input');
      assert.equal((await commit({from: source})).code,'invalid_input');
      assert.equal((await swaps()).length,0);
    });
    await trial('usual refresh seed and stale plans cannot commit', async () => {
      assert.equal((await commit({expected: null})).code,'stale_generation');
      assert.equal((await commit({planned:new Date(Date.now()-120000).toISOString()})).code,'stale_generation');
      await db.query('update dating_1on1_cards set recommendation_refresh_used_at=now() where id=$1',[source]);
      assert.equal((await commit()).code,'stale_generation');
      assert.equal((await swaps()).length,0);
    });
    await trial('successful mutation takes a transaction-scoped advisory lock shared with hide/restore', async () => {
      assert.equal((await commit()).code,'swapped');
      const [lock] = await rows("select count(*)::int n from pg_locks where pid=pg_backend_pid() and locktype='advisory' and granted");
      assert.equal(lock.n,1);
    });
    for (const [label, change, code] of [
      ['latest source',`insert into dating_1on1_cards values('${id(14)}','${viewer}','male','approved',1997,null,now(),now())`,'source_unavailable'],
      ['viewer ban',`update profiles set is_banned=true where user_id='${viewer}'`,'source_unavailable'],
      ['source edited since selecting',`update dating_1on1_cards set updated_at=now()+interval '1 second' where id='${source}'`,'stale_generation'],
      ['recipient ban',`update auth.users set banned_until=now()+interval '1 day' where id='${toUser}'`,'candidate_unavailable'],
      ['recipient edited since selecting',`update dating_1on1_cards set updated_at=now()+interval '1 second' where id='${toCard}'`,'candidate_unavailable'],
      ['recipient under age',`update dating_1on1_cards set birth_year=extract(year from now())::int-18 where id='${toCard}'`,'candidate_unavailable'],
      ['recipient not active',`update dating_1on1_cards set status='rejected' where id='${toCard}'`,'candidate_unavailable'],
      ['recipient same gender',`update dating_1on1_cards set sex='male' where id='${toCard}'`,'candidate_unavailable'],
      ['recipient newer profile',`insert into dating_1on1_cards values('${id(15)}','${toUser}','female','approved',1997,null,now(),now())`,'candidate_unavailable'],
      ['donor seen only after generation',`update dating_1on1_candidate_impressions set first_seen_at=now() where candidate_user_id='${fromUser}'`,'stale_generation'],
      ['replacement has impression, by user identity',`insert into dating_1on1_candidate_impressions values('${viewer}','${toUser}',now()-interval '1 day')`,'already_seen'],
      ['replacement hidden',`insert into dating_1on1_candidate_hides values('${viewer}','${toUser}')`,'candidate_excluded'],
      ['replacement favorited',`insert into dating_1on1_candidate_favorites values('${viewer}','${toCard}')`,'candidate_excluded'],
      ['pair history either side',`insert into dating_1on1_match_proposals values('${toUser}','${viewer}','source_skipped',null)`,'candidate_excluded'],
      ['member block either side',`insert into dating_user_blocks values('${toUser}','${viewer}')`,'candidate_excluded'],
      ['admin block either side',`insert into dating_1on1_admin_user_blocks values('${viewer}','${toUser}')`,'candidate_excluded'],
      ['phone block appended during plan',`insert into dating_1on1_phone_blocks values('${toUser}',now()+interval '1 second')`,'candidate_excluded'],
      ['contact block appended during plan',`insert into dating_contact_blocks values('${viewer}',now()+interval '1 second')`,'candidate_excluded'],
      ['already included in saved extra',`update dating_1on1_recommendation_pages set extra_candidate_ids=array['${toCard}'::uuid]`,'candidate_excluded'],
    ]) await trial(label, async () => {
      await db.exec(change);
      assert.deepEqual(await commit(),{ok:false,code});
      assert.equal((await swaps()).length,0);
    });
  } finally { await db.close(); }
});
