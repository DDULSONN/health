/* eslint-disable @typescript-eslint/no-require-imports */
// Real local PostgreSQL semantics, no live credentials or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.REFRESH_TEST_PGLITE_PATH || '@electric-sql/pglite');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/sql/dating_1on1_checked_refresh.sql'), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001', card = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';

test('checked refresh SQL is repeatable, atomic, CAS guarded and service-role only', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table profiles(user_id uuid primary key, is_banned boolean);
      create table dating_1on1_cards(id uuid primary key, user_id uuid, status text, recommendation_refresh_used_at timestamptz, updated_at timestamptz, intro_text text);
      create table dating_1on1_recommendation_refresh_events(id bigint generated always as identity,card_id uuid,user_id uuid,refreshed_at timestamptz);
      create table dating_1on1_plus_subscriptions(user_id uuid,expires_at timestamptz);
      insert into profiles values('${owner}',false);
      insert into dating_1on1_cards values('${card}','${owner}','approved',null,null,'한글 원문 그대로');`);
    await db.exec(sql); await db.exec(sql);
    const get = async query => (await db.query(query)).rows;
    const count = async () => Number((await get('select count(*) n from dating_1on1_recommendation_refresh_events'))[0].n);
    const stamp = async () => (await get("select date_trunc('milliseconds', clock_timestamp())::text t"))[0].t;
    const call = async ({ user = owner, id = card, limit = 1, expected = null, at = null } = {}) => (await db.query(
      'select * from consume_dating_1on1_recommendation_refresh_checked($1,$2,$3,$4,$5)',
      [id, user, limit, expected, at || await stamp()])).rows[0];
    const reset = async () => db.exec(`delete from dating_1on1_recommendation_refresh_events;
      delete from dating_1on1_plus_subscriptions; update profiles set is_banned=false;
      update dating_1on1_cards set recommendation_refresh_used_at=null,status='approved';`);

    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(call(), /permission denied/); await db.exec('reset role');
    }
    await db.exec('set role service_role');
    const at = await stamp(), first = await call({ at });
    assert.equal(first.allowed, true); assert.equal(first.reason, 'consumed');
    assert.equal(new Date(first.refreshed_at).getTime(), Date.parse(at)); assert.equal(first.remaining_count, 0);
    await db.exec('reset role');
    assert.equal(await count(), 1);
    const stale = await call({ at }); assert.equal(stale.reason, 'stale'); assert.equal(await count(), 1);
    const exhausted = await call({ expected: at, at: new Date(Date.parse(at)+1).toISOString() });
    assert.equal(exhausted.reason, 'limit'); assert.equal(await count(), 1);
    assert.equal((await get('select intro_text from dating_1on1_cards'))[0].intro_text, '한글 원문 그대로');

    await reset();
    const legacy = (await get("select (clock_timestamp()-interval '1 hour')::text t"))[0].t;
    await db.query('update dating_1on1_cards set recommendation_refresh_used_at=$1', [legacy]);
    assert.equal((await call({ expected: legacy })).reason, 'limit'); assert.equal(await count(), 0);
    await db.exec(`insert into dating_1on1_plus_subscriptions values('${owner}',clock_timestamp()+interval '7 days')`);
    const plus = await call({ limit: 2, expected: legacy });
    assert.equal(plus.allowed, true); assert.equal(plus.used_count, 2); assert.equal(plus.remaining_count, 0);
    assert.equal(await count(), 2);

    await reset();
    await db.exec(`insert into dating_1on1_plus_subscriptions values('${owner}',clock_timestamp()+interval '7 days')`);
    const concurrentAt = await stamp();
    const results = await Promise.all([call({ limit: 2, at: concurrentAt }), call({ limit: 2, at: concurrentAt })]);
    assert.deepEqual(results.map(r => r.reason).sort(), ['consumed', 'stale']); assert.equal(await count(), 1);
    const second = await call({ limit: 2, expected: concurrentAt, at: new Date(Date.parse(concurrentAt)+1).toISOString() });
    assert.equal(second.allowed, true); assert.equal(second.remaining_count, 0); assert.equal(await count(), 2);

    await reset();
    for (const options of [{ user: other }, { id: other }, { limit: 99 }, { limit: 2 },
      { at: new Date(Date.now()-300000).toISOString() }, { at: new Date(Date.now()+60000).toISOString() }]) {
      await assert.rejects(call(options)); assert.equal(await count(), 0);
    }
    await db.exec('update profiles set is_banned=true'); await assert.rejects(call(), /account is not eligible/);
    await reset(); await db.exec("update dating_1on1_cards set status='rejected'"); await assert.rejects(call(), /not eligible/);
    await reset(); await db.exec('delete from profiles'); await assert.rejects(call(), /account is not eligible/);
    await db.exec(`insert into profiles values('${owner}',false)`);

    // A post-insert failure rolls the event and card update back in one transaction.
    await db.exec(`create function fail_refresh_write() returns trigger language plpgsql as $$ begin raise exception 'fixture write failure'; end $$;
      create trigger fixture_fail before update on dating_1on1_cards for each row execute function fail_refresh_write();`);
    await assert.rejects(call(), /fixture write failure/); assert.equal(await count(), 0);
    assert.equal((await get('select recommendation_refresh_used_at from dating_1on1_cards'))[0].recommendation_refresh_used_at, null);
  } finally { await db.close(); }
});
