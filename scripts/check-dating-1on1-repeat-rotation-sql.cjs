/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { PGlite } = require(process.env.REFRESH_TEST_PGLITE_PATH || '@electric-sql/pglite');
const sql = name => fs.readFileSync(path.join(__dirname, '../supabase/sql/' + name + '.sql'), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001', card = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
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
