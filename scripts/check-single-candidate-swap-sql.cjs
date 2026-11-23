/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const sql = name => fs.readFileSync(path.resolve(__dirname, '../supabase/sql', name + '.sql'), 'utf8');
const migration = sql('dating_1on1_single_candidate_swaps');
const legacySignature = 'commit_dating_1on1_single_candidate_swap(uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,timestamptz)';
const signature = 'commit_dating_1on1_single_candidate_swap(uuid,uuid,text,timestamptz,timestamptz,uuid,uuid,timestamptz,text,text)';
const guardedSignature = 'commit_dating_1on1_recommendation_page_guarded(uuid,uuid,integer,timestamptz,timestamptz,uuid[],uuid[],boolean,text,integer,timestamptz)';
const key = (sex, year = 1997, region = '서울') => createHash('md5').update(`${sex}:${year}:${region}`).digest('hex');
const staleRefresh = {allowed: false, reason: 'stale', used_count: null, remaining_count: null, refreshed_at: null, next_refresh_at: null};
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
    const input = { user: viewer, source, generation, pageAt, expected: pageAt, from: fromCard, to: toCard, planned: stamp(),
      sourceKey: key('male'), toKey: key('female'), ...opts };
    return (await rows('select commit_dating_1on1_single_candidate_swap($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result', Object.values(input)))[0].result;
  };
  const fullRefresh = async (opts = {}, guarded = true) => {
    const args = { source, user: viewer, limit: 1, expected: pageAt, at: stamp(), main: [altCard], extra: [],
      repeatOnly: false, sourceKey: key('male'), swapCount: 0, latest: null, ...opts };
    const values = Object.values(args);
    return guarded
      ? (await rows('select * from commit_dating_1on1_recommendation_page_guarded($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',values))[0]
      : (await rows('select * from commit_dating_1on1_recommendation_page($1,$2,$3,$4,$5,$6,$7,$8,$9)',values.slice(0,9)))[0];
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
        updated_at timestamptz not null default now() - interval '60 days', region text not null default '서울'
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
      create table dating_1on1_plus_subscriptions (user_id uuid, expires_at timestamptz);
      create table payments (user_id uuid, amount int);
      create table notifications (user_id uuid, title text);
      create function ${legacySignature} returns jsonb language sql as 'select jsonb_build_object(''ok'',true)';
    `);
    for (const file of ['dating_1on1_checked_refresh','dating_1on1_repeat_rotation','dating_1on1_recommendation_pages']) await db.exec(sql(file));
    for (const user of [viewer, fromUser, toUser, altUser, from2User, otherUser]) {
      await db.query('insert into auth.users(id) values($1)', [user]);
      await db.query('insert into profiles(user_id) values($1)', [user]);
    }
    for (const [card, user, sex] of [[source, viewer, 'male'], [fromCard, fromUser], [toCard, toUser],
      [altCard, altUser], [from2Card, from2User], [otherSource, otherUser, 'male']]) await insertCard(card, user, sex);
    await db.query('update dating_1on1_cards set recommendation_refresh_used_at=$1 where id=$2', [pageAt, source]);
    await db.query('insert into dating_1on1_recommendation_pages values($1,$2,$3,$4,$5,$6)', [viewer, source, pageAt, key('male'), [fromCard, from2Card], []]);
    await db.query("insert into dating_1on1_candidate_impressions values($1,$2,now()-interval '2 days'),($1,$3,now()-interval '3 days')", [viewer, fromUser, from2User]);
    await db.query('insert into dating_1on1_recommendation_refresh_events values($1,$2,$3,null)', [viewer, source, pageAt]);
    await db.query("insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,used_count,evidence) values($1,'fixture',2,1,'{}')", [viewer]);
    await db.query("insert into dating_1on1_match_proposals values($1,$2,'mutual_accepted','existing-match')", [viewer, otherUser]);
    await db.query('insert into payments values($1,18000)', [viewer]);
    await db.query("insert into notifications values($1,'old notification')", [viewer]);
    await db.exec(migration);
    await db.exec(migration);

    await trial('member and guest receive neither table nor function permissions; service role has read+RPC only', async () => {
      for (const [role, expected] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
        const [allowed] = await rows("select has_table_privilege($1,'dating_1on1_single_candidate_swaps','select') as sel, has_table_privilege($1,'dating_1on1_single_candidate_swaps','insert,update,delete') as write, has_function_privilege($1,$2,'execute') as execute, has_function_privilege($1,$3,'execute') as guarded, has_function_privilege($1,$4,'execute') as legacy", [role, signature, guardedSignature, legacySignature]);
        assert.deepEqual(allowed, {sel: expected, write: false, execute: expected, guarded: expected, legacy: false});
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
    await trial('a swap-winning race blocks a stale full refresh before bonus, normal events, or base page are touched', async () => {
      const snapshot = () => Promise.all(['dating_1on1_recommendation_pages','dating_1on1_refresh_compensations','dating_1on1_recommendation_refresh_events']
        .map(table => rows(`select * from ${table} order by 1`)));
      const old = await snapshot();
      assert.equal((await commit()).code,'swapped');
      assert.deepEqual(await fullRefresh(),staleRefresh);
      assert.deepEqual(await snapshot(),old);
      // Correct count but stale latest timestamp must not be accepted either.
      assert.deepEqual(await fullRefresh({swapCount:1,latest:pageAt}),staleRefresh);
      assert.deepEqual(await snapshot(),old);
      const [version] = await rows('select max(created_at)::text as latest from dating_1on1_single_candidate_swaps where user_id=$1',[viewer]);
      const refreshed = await fullRefresh({swapCount:1,latest:version.latest,repeatOnly:true});
      assert.equal(refreshed.allowed,true);
      assert.equal(refreshed.reason,'rotated');
      assert.equal(refreshed.remaining_count,1);
      assert.deepEqual((await rows('select used_count from dating_1on1_refresh_compensations')),[{used_count:1}]);
      assert.equal((await swaps()).length,1);
    });
    await trial('a full-refresh-winning race invalidates the old slot plan and only the delegated operation charges', async () => {
      const result = await fullRefresh();
      assert.equal(result.allowed,true);
      assert.equal(result.reason,'consumed');
      assert.deepEqual((await rows('select used_count from dating_1on1_refresh_compensations')),[{used_count:2}]);
      assert.equal((await commit()).code,'stale_generation');
      assert.equal((await swaps()).length,0);
    });
    await trial('without a revision change the guard preserves the original full refresh table and result', async () => {
      const at = stamp(), args = {at};
      await db.exec('savepoint direct_baseline');
      const unguarded = await fullRefresh(args,false);
      const priorEvents = await rows('select card_id,user_id,refreshed_at,compensation_campaign,rotation_only from dating_1on1_recommendation_refresh_events order by refreshed_at');
      const priorPage = await rows('select * from dating_1on1_recommendation_pages');
      await db.exec('rollback to savepoint direct_baseline');
      const guarded = await fullRefresh(args);
      assert.deepEqual(guarded,unguarded);
      assert.equal(guarded.reason,'consumed');
      assert.deepEqual(await rows('select card_id,user_id,refreshed_at,compensation_campaign,rotation_only from dating_1on1_recommendation_refresh_events order by refreshed_at'),priorEvents);
      assert.deepEqual(await rows('select * from dating_1on1_recommendation_pages'),priorPage);
    });
    await trial('overlay revision is viewer-wide across own source cards, not shared across viewers', async () => {
      const older = id(71);
      await insertCard(older,viewer,'male');
      await db.query("update dating_1on1_cards set status='rejected' where id=$1",[older]);
      await db.query('insert into dating_1on1_single_candidate_swaps values($1,$2,$3,$4,$5,$6,now())',[otherUser,otherSource,generation,fromCard,altCard,altUser]);
      await db.query('insert into dating_1on1_single_candidate_swaps values($1,$2,$3,$4,$5,$6,now())',[viewer,older,generation,fromCard,toCard,toUser]);
      assert.deepEqual(await fullRefresh(),staleRefresh);
      const [version] = await rows('select max(created_at)::text as latest from dating_1on1_single_candidate_swaps where user_id=$1',[viewer]);
      assert.equal((await fullRefresh({swapCount:1,latest:version.latest})).reason,'consumed');
    });
    for (const [label, change, code] of [
      ['latest source',`insert into dating_1on1_cards values('${id(14)}','${viewer}','male','approved',1997,null,now(),now())`,'source_unavailable'],
      ['viewer ban',`update profiles set is_banned=true where user_id='${viewer}'`,'source_unavailable'],
      ['source edited since selecting',`update dating_1on1_cards set updated_at=now()+interval '1 second' where id='${source}'`,'stale_generation'],
      ['source region changed without a timestamp bump',`update dating_1on1_cards set region='대구' where id='${source}'`,'stale_generation'],
      ['recipient ban',`update auth.users set banned_until=now()+interval '1 day' where id='${toUser}'`,'candidate_unavailable'],
      ['recipient edited since selecting',`update dating_1on1_cards set updated_at=now()+interval '1 second' where id='${toCard}'`,'candidate_unavailable'],
      ['recipient age changed without a timestamp bump',`update dating_1on1_cards set birth_year=1975 where id='${toCard}'`,'candidate_unavailable'],
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
