/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PRIVACY_TEST_PGLITE_PATH || '@electric-sql/pglite');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/sql/dating_1on1_recommendation_recovery_once.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, deleted_at timestamptz);
      create table public.profiles(user_id uuid primary key, is_banned boolean default false);
      create table public.dating_1on1_cards(id uuid primary key, user_id uuid, status text,
        created_at timestamptz default '2026-08-01', recommendation_refresh_used_at timestamptz);
      create table public.dating_1on1_recommendation_refresh_events(card_id uuid, user_id uuid, refreshed_at timestamptz);
      create table public.dating_1on1_match_proposals(id int, state text);
      insert into dating_1on1_match_proposals values(1,'mutual_accepted');`);
    for (let i = 1; i <= 8; i++) {
      await db.query('insert into auth.users(id) values($1)', [id(i)]);
      await db.query('insert into profiles(user_id) values($1)', [id(i)]);
      await db.query("insert into dating_1on1_cards(id,user_id,status,recommendation_refresh_used_at) values($1,$1,'approved','2026-09-08 12:00:00+00')", [id(i)]);
      await db.query("insert into dating_1on1_recommendation_refresh_events values($1,$1,'2026-09-06 12:00:00+00'),($1,$1,'2026-09-08 12:00:00+00')", [id(i)]);
    }
    await db.query('update profiles set is_banned=true where user_id=$1', [id(2)]);
    await db.query('delete from profiles where user_id=$1', [id(3)]);
    await db.query('update auth.users set deleted_at=now() where id=$1', [id(4)]);
    await db.query("update dating_1on1_cards set status='rejected' where id=$1", [id(5)]);
    await db.query("update dating_1on1_recommendation_refresh_events set refreshed_at='2026-09-08 12:00:00+00' where card_id=$1", [id(6)]);
    await db.query("update dating_1on1_recommendation_refresh_events set refreshed_at=refreshed_at+interval '10 days' where card_id=$1", [id(7)]);
    await db.query("insert into dating_1on1_cards(id,user_id,status,created_at) values($1,$2,'approved','2026-09-08')", [id(88), id(8)]);
    const snapshot = async () => (await db.query(`select jsonb_build_object(
      'cards',(select jsonb_agg(c order by id) from dating_1on1_cards c),
      'events',(select jsonb_agg(e order by card_id,refreshed_at) from dating_1on1_recommendation_refresh_events e),
      'matches',(select jsonb_agg(m) from dating_1on1_match_proposals m)) as value`)).rows[0].value;
    const before = await snapshot();
    await db.exec(sql);
    const recovered = (await db.query('select * from dating_1on1_recommendation_recoveries')).rows;
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].user_id, id(1));
    assert.equal(recovered[0].card_id, id(1));
    assert.deepEqual(await snapshot(), before);
    console.log('PASS: only the current eligible account is recovered; usage and matches unchanged');
    await db.exec(sql);
    assert.deepEqual((await db.query('select * from dating_1on1_recommendation_recoveries')).rows, recovered);
    console.log('PASS: rerunning does not add or change a recovery');
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.dating_1on1_recommendation_recoveries'), /permission denied/);
      await assert.rejects(db.query('insert into public.dating_1on1_recommendation_recoveries(user_id,card_id) values($1,$1)', [id(2)]), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await db.query('select * from public.dating_1on1_recommendation_recoveries')).rows.length, 1);
    await assert.rejects(db.query('update public.dating_1on1_recommendation_recoveries set refreshed_at=now()'), /permission denied/);
    await db.exec('reset role');
    console.log('PASS: clients cannot read/grant recovery; server cannot overwrite the timestamp');
    await db.query('delete from dating_1on1_cards where id=$1', [id(1)]);
    assert.equal((await db.query('select card_id from dating_1on1_recommendation_recoveries')).rows[0].card_id, null);
    await db.query("insert into dating_1on1_cards(id,user_id,status) values($1,$2,'approved')", [id(99), id(1)]);
    await db.query('update dating_1on1_recommendation_refresh_events set card_id=$1 where user_id=$2', [id(99), id(1)]);
    await db.exec(sql);
    assert.equal((await db.query('select count(*)::int as n from dating_1on1_recommendation_recoveries')).rows[0].n, 1);
    assert.equal((await db.query('select card_id from dating_1on1_recommendation_recoveries')).rows[0].card_id, null);
    console.log('PASS: deleting/recreating a profile cannot obtain the correction twice');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
