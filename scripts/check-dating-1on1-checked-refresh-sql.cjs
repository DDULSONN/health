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
      create schema auth; create table auth.users(id uuid primary key);
      insert into auth.users values('${owner}'),('${other}');
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
      delete from dating_1on1_refresh_compensations;
      delete from dating_1on1_plus_subscriptions; update profiles set is_banned=false;
      update dating_1on1_cards set recommendation_refresh_used_at=null,status='approved';`);

    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(db.exec('select * from dating_1on1_refresh_compensations'), /permission denied/);
      await assert.rejects(db.exec(`insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,evidence) values('${owner}','forged',2,'{}')`), /permission denied/);
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

    // Release two charges without deleting seeds or resetting the source card.
    const history = await get('select id,card_id,user_id,refreshed_at from dating_1on1_recommendation_refresh_events order by id');
    const sourceBeforeRefund = await get('select * from dating_1on1_cards');
    await db.exec('update dating_1on1_recommendation_refresh_events set quota_refunded_at=clock_timestamp()');
    assert.deepEqual(await get('select id,card_id,user_id,refreshed_at from dating_1on1_recommendation_refresh_events order by id'), history);
    assert.deepEqual(await get('select * from dating_1on1_cards'), sourceBeforeRefund);
    const refundedFirstAt = new Date(Date.parse(await stamp()) + 1).toISOString();
    const refundedFirst = await call({ limit: 2, expected: second.refreshed_at, at: refundedFirstAt });
    assert.equal(refundedFirst.allowed, true); assert.equal(refundedFirst.used_count, 1); assert.equal(refundedFirst.remaining_count, 1);
    const refundedSecondAt = new Date(Date.parse(refundedFirstAt) + 1).toISOString();
    const refundedSecond = await call({ limit: 2, expected: refundedFirstAt, at: refundedSecondAt });
    assert.equal(refundedSecond.allowed, true); assert.equal(refundedSecond.used_count, 2); assert.equal(refundedSecond.remaining_count, 0);
    assert.equal(await count(), 4);
    const refundedThird = await call({ limit: 2, expected: refundedSecondAt, at: new Date(Date.parse(refundedSecondAt)+1).toISOString() });
    assert.equal(refundedThird.allowed, false); assert.equal(refundedThird.reason, 'limit'); assert.equal(await count(), 4);
    for (const role of ['anon', 'authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(db.exec('update dating_1on1_recommendation_refresh_events set quota_refunded_at=now()'), /permission denied/);
      await db.exec('reset role');
    }

    await reset();
    for (const options of [{ user: other }, { id: other }, { limit: 99 }, { limit: 2 },
      { at: new Date(Date.now()-300000).toISOString() }, { at: new Date(Date.now()+60000).toISOString() }]) {
      await assert.rejects(call(options)); assert.equal(await count(), 0);
    }
    await db.exec('update profiles set is_banned=true'); await assert.rejects(call(), /account is not eligible/);
    await reset(); await db.exec("update dating_1on1_cards set status='rejected'"); await assert.rejects(call(), /not eligible/);
    await reset(); await db.exec('delete from profiles'); await assert.rejects(call(), /account is not eligible/);
    await db.exec(`insert into profiles values('${owner}',false)`);

    // Credits are account-scoped, durable, idempotent and consumed only after normal quota.
    for (const limit of [1, 2]) {
      await reset();
      if (limit === 2) await db.exec(`insert into dating_1on1_plus_subscriptions values('${owner}',now()+interval '7 days')`);
      const grant = `insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,granted_at,evidence)
        values('${owner}','incident',2,now()-interval '90 days','{"source":"fixture"}') on conflict do nothing`;
      await db.exec(grant); await db.exec(grant);
      const balance = async () => (await get('select granted_count-used_count n from dating_1on1_refresh_compensations'))[0].n;
      assert.equal(await balance(), 2);
      let expected = null;
      for (let i=0; i<limit+2; i++) {
        const at = new Date(Date.parse(await stamp())+i+1).toISOString();
        const res = await call({ limit, expected, at }); expected=at;
        assert.equal(res.allowed, true); assert.equal(res.remaining_count, limit+1-i);
        assert.equal(res.used_count, Math.min(i+1,limit));
        assert.equal(await balance(), Math.max(0,2-Math.max(0,i+1-limit)));
        if (res.remaining_count) assert.equal(res.next_refresh_at, null);
      }
      await db.exec(grant); assert.equal(await balance(),0,'re-running grant must not replenish spent credits');
      assert.equal((await call({limit,expected,at:new Date(Date.parse(expected)+1).toISOString()})).reason,'limit');
      assert.equal((await get("select count(*)::int n from dating_1on1_recommendation_refresh_events where compensation_campaign='incident' and quota_refunded_at is not null"))[0].n,2);
      assert.equal((await get('select intro_text from dating_1on1_cards'))[0].intro_text,'한글 원문 그대로');
    }

    // A lapsed Plus member can have two normal charges but a current limit of one.
    // They cannot use another normal refresh until BOTH charges leave the window.
    await reset();
    const expiredPlusTimes = await get("select (clock_timestamp()-interval '2 hours')::text older, (clock_timestamp()-interval '1 hour')::text newer");
    const { older, newer } = expiredPlusTimes[0];
    await db.query(`insert into dating_1on1_recommendation_refresh_events(card_id,user_id,refreshed_at)
      values($1,$2,$3),($1,$2,$4)`, [card,owner,older,newer]);
    await db.query('update dating_1on1_cards set recommendation_refresh_used_at=$1', [newer]);
    await db.exec(`insert into dating_1on1_plus_subscriptions values('${owner}',now()-interval '1 minute')`);
    const downgraded = await call({ expected: newer });
    assert.equal(downgraded.reason, 'limit'); assert.equal(downgraded.used_count, 2);
    assert.equal(new Date(downgraded.next_refresh_at).getTime(), Date.parse(newer)+86400000);
    await db.exec(`insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,used_count,evidence)
      values('${owner}','incident',2,1,'{}')`);
    // An expired Plus plan may not consume even a bonus credit with its stale limit.
    await assert.rejects(call({ limit: 2, expected: newer }), /plus membership changed/);
    assert.equal((await get('select used_count n from dating_1on1_refresh_compensations'))[0].n,1);
    const lastBonus = await call({ expected: newer });
    assert.equal(lastBonus.allowed,true); assert.equal(lastBonus.remaining_count,0);
    assert.equal(new Date(lastBonus.next_refresh_at).getTime(),Date.parse(newer)+86400000);
    // Only normal charges age out. A recent bonus seed must never become a legacy charge.
    await db.exec("update dating_1on1_recommendation_refresh_events set refreshed_at=refreshed_at-interval '2 days' where quota_refunded_at is null");
    const restored = await call({ expected:lastBonus.refreshed_at, at:new Date(Date.parse(await stamp())+1).toISOString() });
    assert.equal(restored.allowed,true); assert.equal(restored.used_count,1);
    assert.equal((await get('select used_count n from dating_1on1_refresh_compensations'))[0].n,2,'spent bonuses never recharge');

    await reset();
    await db.exec(`insert into dating_1on1_refresh_compensations(user_id,campaign_key,granted_count,evidence) values('${owner}','incident',2,'{}');
      update dating_1on1_cards set recommendation_refresh_used_at=now()-interval '1 hour';`);
    const legacyForBonus=(await get('select recommendation_refresh_used_at::text t from dating_1on1_cards'))[0].t;
    const sameAt=await stamp();
    const racing=await Promise.all([call({expected:legacyForBonus,at:sameAt}),call({expected:legacyForBonus,at:sameAt})]);
    assert.deepEqual(racing.map(r=>r.reason).sort(),['consumed','stale']);
    assert.equal((await get('select used_count n from dating_1on1_refresh_compensations'))[0].n,1);

    // A second active source cannot double-spend the last account-level credit.
    await db.exec(`insert into dating_1on1_cards values('${other}','${owner}','approved',now()-interval '1 hour',null,'별도 테스트');`);
    const otherStamp=(await get(`select recommendation_refresh_used_at::text t from dating_1on1_cards where id='${other}'`))[0].t;
    const crossAt=new Date(Date.parse(sameAt)+2).toISOString();
    const cross=await Promise.all([call({expected:sameAt,at:crossAt}),call({id:other,expected:otherStamp,at:crossAt})]);
    assert.deepEqual(cross.map(r=>r.reason).sort(),['consumed','limit']);
    assert.equal((await get('select used_count n from dating_1on1_refresh_compensations'))[0].n,2);
    await db.exec(`delete from dating_1on1_cards where id='${other}';
      update dating_1on1_refresh_compensations set used_count=1;
      update dating_1on1_cards set recommendation_refresh_used_at='${sameAt}';`);

    // A post-insert failure rolls the bonus, event and card update back together.
    const eventsBeforeFailure=await count();
    const sourceBeforeFailure=(await get('select recommendation_refresh_used_at from dating_1on1_cards'))[0].recommendation_refresh_used_at;
    await db.exec(`create function fail_refresh_write() returns trigger language plpgsql as $$ begin raise exception 'fixture write failure'; end $$;
      create trigger fixture_fail before update on dating_1on1_cards for each row execute function fail_refresh_write();`);
    await assert.rejects(call({expected:sameAt,at:new Date(Date.parse(sameAt)+1).toISOString()}), /fixture write failure/);
    assert.equal(await count(),eventsBeforeFailure);
    assert.deepEqual((await get('select recommendation_refresh_used_at from dating_1on1_cards'))[0].recommendation_refresh_used_at,sourceBeforeFailure);
    assert.equal((await get('select used_count n from dating_1on1_refresh_compensations'))[0].n,1);
  } finally { await db.close(); }
});
