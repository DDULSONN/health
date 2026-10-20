/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require(process.env.REFRESH_TEST_PGLITE_PATH || '@electric-sql/pglite');
const sql = name => fs.readFileSync(path.join(__dirname, '../supabase/sql/' + name + '.sql'), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001', card = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';

test('saved recommendation page commits with quota atomically, with private roles and no fallback write', async () => {
  const db = new PGlite();
  const candidate = '00000000-0000-4000-8000-000000000004';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values('${owner}'),('${other}');
      create table profiles(user_id uuid primary key, is_banned boolean);
      create table dating_1on1_cards(id uuid primary key, user_id uuid, sex text, status text, recommendation_refresh_used_at timestamptz, updated_at timestamptz, intro_text text, birth_year integer default 1996, region text default '서울 강남구');
      create table dating_1on1_recommendation_refresh_events(id bigint generated always as identity,card_id uuid,user_id uuid,refreshed_at timestamptz);
      create table dating_1on1_plus_subscriptions(user_id uuid,expires_at timestamptz);
      insert into profiles values('${owner}',false),('${other}',false);
      insert into dating_1on1_cards(id,user_id,sex,status,recommendation_refresh_used_at,updated_at,intro_text) values('${card}','${owner}','male','approved',null,null,'프로필 원문'),
        ('${candidate}','${other}','female','approved',null,null,'상대 프로필');`);
    await db.exec(sql('dating_1on1_checked_refresh')); await db.exec(sql('dating_1on1_repeat_rotation'));
    await db.exec(sql('dating_1on1_recommendation_pages')); await db.exec(sql('dating_1on1_recommendation_pages'));
    await db.exec(sql('dating_1on1_recommendation_page_history')); await db.exec(sql('dating_1on1_recommendation_page_history'));
    const rows = async q => (await db.query(q)).rows;
    const stamp = async () => (await rows("select date_trunc('milliseconds',clock_timestamp())::text t"))[0].t;
    const sourceKey = require('node:crypto').createHash('md5').update('male:1996:서울 강남구').digest('hex');
    const call = async ({ main = [candidate], extra = [], repeat = false, expected = null, at, user = owner, key = sourceKey } = {}) =>
      (await db.query('select * from commit_dating_1on1_recommendation_page($1,$2,$3,$4,$5,$6::uuid[],$7::uuid[],$8,$9)',
        [card, user, 1, expected, at || await stamp(), main, extra, repeat, key])).rows[0];
    const reset = async () => db.exec(`delete from dating_1on1_recommendation_page_history; delete from dating_1on1_recommendation_pages; delete from dating_1on1_recommendation_refresh_events;
      delete from dating_1on1_refresh_compensations; update dating_1on1_cards set recommendation_refresh_used_at=null,status='approved'; update profiles set is_banned=false;`);
    const snapshot = async () => ({ pages: await rows('select * from dating_1on1_recommendation_pages'),
      history: await rows('select * from dating_1on1_recommendation_page_history order by refreshed_at'),
      events: await rows('select * from dating_1on1_recommendation_refresh_events'),
      cards: await rows('select id,recommendation_refresh_used_at,intro_text from dating_1on1_cards order by id'),
      credits: await rows('select granted_count,used_count from dating_1on1_refresh_compensations') });
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(call(), /permission denied/);
      await assert.rejects(rows('select * from dating_1on1_recommendation_pages'), /permission denied/);
      await assert.rejects(rows('select * from dating_1on1_recommendation_page_history'), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role'); const saved = await call(); await db.exec('reset role');
    assert.equal(saved.reason, 'consumed'); assert.equal(saved.remaining_count, 0);
    assert.deepEqual((await snapshot()).pages[0].main_candidate_ids, [candidate]);
    assert.equal((await snapshot()).pages[0].refreshed_at.getTime(), saved.refreshed_at.getTime());
    assert.equal((await snapshot()).history.length, 1);
    assert.deepEqual((await snapshot()).history[0].main_candidate_ids, [candidate]);
    const prior = await snapshot();
    assert.equal((await call()).reason, 'stale'); assert.deepEqual(await snapshot(), prior);
    await reset();
    const free = await call({ repeat: true }); assert.equal(free.reason, 'rotated'); assert.equal(free.remaining_count, 1);
    assert.equal((await snapshot()).events[0].rotation_only, true);
    assert.equal((await snapshot()).pages.length, 1);
    await reset();
    for (const input of [{ main: [] }, { main: [candidate], extra: [candidate] }, { main: [null] },
      { main: Array(11).fill(candidate) }, { extra: Array(4).fill(candidate) }, { main: [card] }, { user: other }, { key: 'outdated-source-settings' }]) {
      const before = await snapshot(); await assert.rejects(call(input)); assert.deepEqual(await snapshot(), before);
    }
    // Eligibility changes AFTER planning roll back the delegated quota/seed writes too.
    for (const update of [`update profiles set is_banned=true where user_id='${other}'`,
      `update dating_1on1_cards set status='rejected' where id='${candidate}'`]) {
      await reset(); await db.exec(update); const before = await snapshot();
      await assert.rejects(call(), /identities changed/); assert.deepEqual(await snapshot(), before);
    }
    await reset();
    await db.exec(`create function fixture_page_fail() returns trigger language plpgsql as $$ begin raise exception 'page save failed'; end $$;
      create trigger fixture_page_fail before insert or update on dating_1on1_recommendation_pages for each row execute function fixture_page_fail();`);
    const before = await snapshot(); await assert.rejects(call(), /page save failed/); assert.deepEqual(await snapshot(), before);
    await assert.rejects(call({ repeat: true }), /page save failed/); assert.deepEqual(await snapshot(), before);
    await db.exec(`update dating_1on1_cards set recommendation_refresh_used_at=clock_timestamp()-interval '1 hour' where id='${card}';
      insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
        select id,user_id,recommendation_refresh_used_at from dating_1on1_cards where id='${card}';
      insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,used_count,evidence)
        values('${owner}','snapshot-test',2,0,'{}');`);
    const bonusBefore = await snapshot(), legacy = bonusBefore.cards.find(c => c.id === card).recommendation_refresh_used_at;
    await assert.rejects(call({ expected: legacy }), /page save failed/); assert.deepEqual(await snapshot(), bonusBefore);
    await db.exec('drop trigger fixture_page_fail on dating_1on1_recommendation_pages');
    await reset();
    const at = await stamp(), racing = await Promise.all([call({ at }), call({ at })]);
    assert.equal(racing.filter(r => r.allowed).length, 1);
    assert.equal((await snapshot()).events.length, 1); assert.equal((await snapshot()).pages.length, 1);
    // A history failure must roll back delegated quota, bonus, seed AND the page.
    await reset();
    await db.exec(`create trigger fixture_history_fail before insert on dating_1on1_recommendation_page_history
      for each row execute function fixture_page_fail();`);
    const failedHistoryBefore = await snapshot();
    await assert.rejects(call(), /page save failed/);
    assert.deepEqual(await snapshot(), failedHistoryBefore);
    await assert.rejects(call({ repeat: true }), /page save failed/);
    assert.deepEqual(await snapshot(), failedHistoryBefore);
    await db.exec(`update dating_1on1_cards set recommendation_refresh_used_at=clock_timestamp()-interval '1 hour' where id='${card}';
      insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
        select id,user_id,recommendation_refresh_used_at from dating_1on1_cards where id='${card}';
      insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,used_count,evidence)
        values('${owner}','history-test',2,0,'{}');`);
    const historyBonusBefore = await snapshot();
    await assert.rejects(call({ expected: historyBonusBefore.cards.find(c => c.id === card).recommendation_refresh_used_at }), /page save failed/);
    assert.deepEqual(await snapshot(), historyBonusBefore);
    await db.exec('drop trigger fixture_history_fail on dating_1on1_recommendation_page_history');
    // Old page capture, bounded history and first record immutability.
    for (let i = 0; i < 70; i++) {
      const at = new Date(Date.now() - (100 - i) * 60000).toISOString();
      await db.query(`insert into dating_1on1_recommendation_pages values($1,$2,$3,$4,$5::uuid[],$6::uuid[])
        on conflict(user_id) do update set refreshed_at=excluded.refreshed_at`, [owner, card, at, sourceKey, [candidate], []]);
    }
    assert.equal((await snapshot()).history.length, 64);
    await db.exec('set role service_role');
    assert.equal((await rows('select count(*)::integer n from dating_1on1_recommendation_page_history'))[0].n, 64);
    await assert.rejects(db.exec('delete from dating_1on1_recommendation_page_history'), /permission denied/);
    await db.exec('reset role');
    await db.exec(`delete from auth.users where id='${owner}'`);
    assert.equal((await snapshot()).pages.length, 0); assert.equal((await snapshot()).history.length, 0);
  } finally { await db.close(); }
});
test('repeat-only rotation is atomic, quota-neutral, bounded and compatible with normal/bonus refreshes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values('${owner}'),('${other}');
      create table profiles(user_id uuid primary key, is_banned boolean);
      create table dating_1on1_cards(id uuid primary key, user_id uuid, status text, recommendation_refresh_used_at timestamptz, updated_at timestamptz, intro_text text);
      create table dating_1on1_recommendation_refresh_events(id bigint generated always as identity,card_id uuid,user_id uuid,refreshed_at timestamptz);
      create table dating_1on1_plus_subscriptions(user_id uuid,expires_at timestamptz);
      insert into profiles values('${owner}',false);
      insert into dating_1on1_cards values('${card}','${owner}','approved',null,null,'프로필 원문');`);
    await db.exec(sql('dating_1on1_checked_refresh'));
    await db.exec(sql('dating_1on1_repeat_rotation')); await db.exec(sql('dating_1on1_repeat_rotation'));
    const rows = async q => (await db.query(q)).rows;
    const stamp = async () => (await rows("select date_trunc('milliseconds', clock_timestamp())::text t"))[0].t;
    const call = async ({ user = owner, id = card, limit = 1, expected = null, at, charged = false } = {}) => (await db.query(
      `select * from ${charged ? 'consume_dating_1on1_recommendation_refresh_checked' : 'rotate_dating_1on1_recommendations_without_charge'}($1,$2,$3,$4,$5)`,
      [id,user,limit,expected,at || await stamp()])).rows[0];
    const reset = async () => db.exec(`delete from dating_1on1_recommendation_refresh_events;
      delete from dating_1on1_refresh_compensations; delete from dating_1on1_plus_subscriptions;
      update profiles set is_banned=false; update dating_1on1_cards set recommendation_refresh_used_at=null,status='approved';`);
    const events = async () => rows('select * from dating_1on1_recommendation_refresh_events order by id');
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role); await assert.rejects(call(), /permission denied/); await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const first = await call(); await db.exec('reset role');
    assert.equal(first.reason, 'rotated'); assert.equal(first.used_count, 0); assert.equal(first.remaining_count, 1);
    assert.equal((await events())[0].rotation_only, true); assert.ok((await events())[0].quota_refunded_at);
    assert.equal((await call()).reason, 'stale');
    assert.equal((await call({ expected: first.refreshed_at, at: new Date(new Date(first.refreshed_at).getTime()+1).toISOString() })).reason, 'cooldown');
    assert.equal((await events()).length, 1);
    // A free seed is not later charged as a legacy use, and a subsequent NEW
    // candidate refresh still consumes exactly one normal allowance.
    const paid = await call({ charged: true, expected: first.refreshed_at, at: new Date(new Date(first.refreshed_at).getTime()+2).toISOString() });
    assert.equal(paid.used_count, 1); assert.equal(paid.remaining_count, 0);
    assert.equal((await call({ expected: paid.refreshed_at, at: new Date(new Date(first.refreshed_at).getTime()+3).toISOString() })).reason, 'limit');

    await reset();
    await db.exec(`insert into dating_1on1_plus_subscriptions values('${owner}',clock_timestamp()+interval '7 days');
      update dating_1on1_cards set recommendation_refresh_used_at=clock_timestamp()-interval '1 hour';
      insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,used_count,evidence)
      values('${owner}','fixture',2,1,'{}');`);
    const legacy = (await rows('select recommendation_refresh_used_at::text t from dating_1on1_cards'))[0].t;
    const rotated = await call({ limit: 2, expected: legacy });
    assert.equal(rotated.used_count, 1); assert.equal(rotated.remaining_count, 2);
    assert.equal((await events()).filter(e => e.quota_refunded_at == null).length, 1, 'legacy use retained');
    assert.equal((await rows('select used_count from dating_1on1_refresh_compensations'))[0].used_count, 1);
    const charged = await call({ charged: true, limit: 2, expected: rotated.refreshed_at, at: new Date(new Date(rotated.refreshed_at).getTime()+1).toISOString() });
    assert.equal(charged.used_count, 2); assert.equal(charged.remaining_count, 1);
    assert.equal((await rows('select used_count from dating_1on1_refresh_compensations'))[0].used_count, 1);
    // Stale Plus limits and wrong identity cannot write a free rotation either.
    await db.exec("update dating_1on1_plus_subscriptions set expires_at=now()-interval '1 minute'");
    await assert.rejects(call({ limit: 2, expected: charged.refreshed_at, at: new Date(new Date(charged.refreshed_at).getTime()+2).toISOString() }), /plus membership changed/);

    await reset();
    for (const options of [{ user: other }, { id: other }, { limit: 3 }, { limit: 2 },
      { at: new Date(Date.now()-300000).toISOString() }, { at: new Date(Date.now()+60000).toISOString() }]) await assert.rejects(call(options));
    await db.exec('update profiles set is_banned=true'); await assert.rejects(call(), /account is not eligible/);
    await reset(); await db.exec("update dating_1on1_cards set status='rejected'"); await assert.rejects(call(), /not eligible/);
    await reset();
    const at = await stamp();
    const racing = await Promise.all([call({ at }), call({ charged: true, at })]);
    assert.equal(racing.filter(r => r.allowed).length, 1); assert.equal(racing.filter(r => r.reason === 'stale').length, 1);
    assert.equal((await events()).length, 1);

    await reset();
    await db.exec(`insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at,quota_refunded_at,rotation_only)
      select '${card}','${owner}',clock_timestamp()-make_interval(mins => n),clock_timestamp(),true from generate_series(1,80) n;`);
    await call(); assert.equal((await events()).length, 64, 'free seed history stays bounded');
    assert.equal((await rows('select intro_text from dating_1on1_cards'))[0].intro_text, '프로필 원문');

    await reset();
    await db.exec(`create function fixture_fail() returns trigger language plpgsql as $$ begin raise exception 'write failed'; end $$;
      create trigger fixture_fail before update on dating_1on1_cards for each row execute function fixture_fail();`);
    await assert.rejects(call(), /write failed/);
    assert.equal((await events()).length, 0);
    assert.equal((await rows('select recommendation_refresh_used_at t from dating_1on1_cards'))[0].t, null);
  } finally { await db.close(); }
});
