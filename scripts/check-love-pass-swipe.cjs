/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const me = id(1);
const myCard = id(1001);
const passId = id(2100);
const peer = id(2);
const peerCard = id(1002);

async function dbFixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table auth.users (id uuid primary key, deleted_at timestamptz, banned_until timestamptz);
    create table public.profiles (user_id uuid primary key references auth.users(id) on delete cascade,
      swipe_profile_visible boolean, phone_verified boolean, is_banned boolean);
    create table public.dating_cards (id uuid primary key, owner_user_id uuid not null references auth.users(id) on delete cascade, sex text,
      status text, instagram_id text, age integer);
    create table public.dating_love_passes (
      id uuid primary key, user_id uuid not null references auth.users(id), starts_at timestamptz not null,
      expires_at timestamptz not null, revoked_at timestamptz
    );
    create function public.get_active_dating_love_pass(p_user_id uuid) returns uuid
      language sql stable security definer set search_path = '' as $$
        select p.id from public.dating_love_passes p where p.user_id = $1 and p.starts_at <= now()
          and p.expires_at > now() and p.revoked_at is null order by p.starts_at desc limit 1
      $$;
    revoke all on function public.get_active_dating_love_pass(uuid) from public;
    grant execute on function public.get_active_dating_love_pass(uuid) to service_role;
  `);
  await db.exec(read('supabase/sql/dating_card_swipe_matches.sql'));
  await db.exec(read('supabase/sql/dating_love_pass_swipe.sql'));
  await db.exec(read('supabase/sql/dating_love_pass_swipe.sql')); // additive and idempotent
  const q = (sql, args = []) => db.query(sql, args);
  for (let n = 1; n <= 56; n++) {
    await q('insert into auth.users (id) values ($1)', [id(n)]);
    await q('insert into public.profiles values ($1, true, true, false)', [id(n)]);
    await q('insert into public.dating_cards values ($1, $2, $3, $4, $5, 30)', [id(1000 + n), id(n), n === 1 ? 'female' : 'male', 'public', `sample${n}`]);
  }
  await q(`insert into public.dating_love_passes values ($1,$2,now()-interval '1 day',now()+interval '29 days',null)`, [passId, me]);
  const record = async (targetNo, action = 'like', actorId = me, actorCardId = myCard) =>
    (await q(`select public.record_dating_love_pass_swipe($1,$2,$3,$4,'male',$5) as result`, [actorId, actorCardId, id(targetNo), id(1000 + targetNo), action])).rows[0].result;
  const status = async userId => (await q(`select public.get_dating_love_pass_swipe_status($1) as result`, [userId])).rows[0].result;
  return { db, q, record, status };
}

test('Love Pass likes count actual writes only, tolerate pass-to-like conversion and never refill after a withdrawal', async t => {
  const { db, q, record, status } = await dbFixture();
  t.after(() => db.close());
  assert.deepEqual(await status(me), { remaining: 50 });
  assert.deepEqual(await record(2, 'pass'), { outcome: 'saved', remaining: 50 });
  assert.deepEqual(await record(2), { outcome: 'saved', remaining: 49 });
  assert.deepEqual(await record(2), { outcome: 'duplicate' });
  assert.deepEqual(await status(me), { remaining: 49 });
  await q('delete from public.dating_card_swipes where actor_user_id = $1 and target_user_id = $2', [me, peer]);
  assert.deepEqual(await record(2), { outcome: 'duplicate' });
  assert.deepEqual(await status(me), { remaining: 49 });
  assert.deepEqual(await record(3, 'pass'), { outcome: 'saved', remaining: 49 });
  // Simulate a pass action from before purchase; converting it must use today's KST budget.
  await q(`update public.dating_card_swipes set created_at=now()-interval '40 hours' where target_user_id=$1`, [id(3)]);
  assert.deepEqual(await record(3), { outcome: 'saved', remaining: 48 });
  const visibility = await q('select user_id from public.get_dating_love_pass_swipe_users($1)', [[me, peer, me]]);
  assert.deepEqual(visibility.rows, [{ user_id: me }]);
  await q('update public.profiles set swipe_profile_visible=false where user_id = $1', [me]);
  assert.deepEqual((await q('select user_id from public.get_dating_love_pass_swipe_users($1)', [[me]])).rows, []);
  await q('delete from auth.users where id = $1', [peer]);
  assert.deepEqual(await status(me), { remaining: 48 }, 'recipient deletion removes the reference, not an already-spent like');
  assert.equal((await q('select count(*)::integer as scrubbed from public.dating_love_pass_swipe_likes where target_user_id is null')).rows[0].scrubbed, 1);
});

test('one purchase never allows more than 50 likes in one Seoul day, but more passes and next-day budget remain available', async t => {
  const { db, q, record, status } = await dbFixture();
  t.after(() => db.close());
  // A like sent before activation today also consumes that day's budget.
  await q(`insert into public.dating_card_swipes (actor_user_id, actor_card_id, target_user_id, target_card_id, target_sex, action)
    values ($1,$2,$3,$4,'male','like')`, [me, myCard, peer, peerCard]);
  assert.deepEqual(await status(me), { remaining: 49 });
  const results = await Promise.all(Array.from({length: 50}, (_, index) => record(index + 3)));
  assert.equal(results.filter(row => row.outcome === 'saved').length, 49);
  assert.equal(results.filter(row => row.outcome === 'limited').length, 1);
  assert.deepEqual(await status(me), { remaining: 0 });
  assert.deepEqual(await record(54, 'pass'), { outcome: 'saved', remaining: 0 });
  assert.deepEqual(await record(54), { outcome: 'limited', remaining: 0 });
  assert.equal((await q('select action from dating_card_swipes where actor_user_id=$1 and target_user_id=$2', [me, id(54)])).rows[0].action, 'pass');
  const boundaries = await q(`
    insert into public.dating_love_pass_swipe_likes (actor_user_id,usage_day,target_user_id,sent_at)
      values ($1,date '2020-01-02',$2,timestamptz '2020-01-02 14:59:59Z');`, [me,id(55)]);
  assert.equal(boundaries.affectedRows, 1);
  const leftAtSeoulMidnight = (await q(`select
      public.dating_love_pass_swipe_likes_left($1,timestamptz '2020-01-02 14:59:59Z') as before,
      public.dating_love_pass_swipe_likes_left($1,timestamptz '2020-01-02 15:00:00Z') as after`, [me])).rows[0];
  assert.deepEqual(leftAtSeoulMidnight, { before: 49, after: 50 });
  assert.match(read('supabase/sql/dating_love_pass_swipe.sql'), /pg_advisory_xact_lock\(hashtextextended\('dating-love-pass:' \|\| p_user_id/);
});

test('inactive or revoked passes, restricted profiles and failed writes cannot create swipes or consume likes', async t => {
  const { db, q, record, status } = await dbFixture();
  t.after(() => db.close());
  assert.equal(await status(peer), null);
  assert.deepEqual(await record(3, 'like', peer, peerCard), { outcome: 'inactive' });
  await q(`update public.dating_cards set status='hidden' where id=$1`, [peerCard]);
  assert.deepEqual(await record(2), { outcome: 'invalid' });
  await q(`update public.dating_cards set status='pending' where id=$1`, [peerCard]);
  await q(`update public.profiles set swipe_profile_visible=false where user_id=$1`, [peer]);
  assert.deepEqual(await record(2, 'pass'), { outcome: 'invalid' });
  await q(`update public.profiles set swipe_profile_visible=true where user_id=$1`, [peer]);
  await q(`update public.dating_cards set age=18 where id=$1`, [peerCard]);
  assert.deepEqual(await record(2), { outcome: 'invalid' });
  await q(`update public.dating_cards set age=23 where id=$1`, [peerCard]);
  await q(`update auth.users set banned_until=now()+interval '1 day' where id=$1`, [peer]);
  assert.deepEqual(await record(2), { outcome: 'invalid' });
  // A later movement/database constraint failure must roll the swipe itself back too.
  await db.exec(`alter table public.dating_love_pass_swipe_likes add constraint test_forced_failure check (false) not valid`);
  await assert.rejects(record(3), { code: '23514' });
  assert.equal((await q('select count(*)::integer as swipes from dating_card_swipes')).rows[0].swipes, 0);
  assert.deepEqual(await status(me), { remaining: 50 });
  await q('update public.dating_love_passes set revoked_at=now() where id=$1', [passId]);
  assert.equal(await status(me), null);
  assert.deepEqual(await record(3), { outcome: 'inactive' });
});

test('only service can call paid swipe SQL; legacy member writes do not acquire paid behavior', async t => {
  const { db, q, record } = await dbFixture();
  t.after(() => db.close());
  await db.exec(`grant usage on schema public, auth to authenticated; grant insert on public.dating_card_swipes to authenticated; set role authenticated;`);
  const direct = (actorId, actorCardId, targetId, targetCardId) => q(`insert into public.dating_card_swipes
    (actor_user_id,actor_card_id,target_user_id,target_card_id,target_sex,action) values ($1,$2,$3,$4,'male','like')`, [actorId, actorCardId, targetId, targetCardId]);
  await q(`select set_config('request.jwt.claim.sub',$1,false)`, [me]);
  await assert.rejects(record(2), { code: '42501' });
  await assert.rejects(direct(me, myCard, peer, peerCard), { code: '42501' });
  await q(`select set_config('request.jwt.claim.sub',$1,false)`, [peer]);
  assert.equal((await direct(peer, peerCard, id(3), id(1003))).affectedRows, 1);
  await db.exec('reset role; set role service_role;');
  assert.deepEqual(await record(2), { outcome: 'saved', remaining: 49 });
});

function mockedSwipeRoute(options = {}) {
  const calls = [];
  const tables = {
    dating_card_swipe_matches: null,
    dating_card_swipes: null,
    dating_cards: {owner_user_id: peer, sex: 'male', instagram_id: 'insta', display_nickname: '상대'},
    profiles: {swipe_profile_visible: true},
  };
  const client = {
    from(table) {
      const b = { then: (resolve,reject) => Promise.resolve({data: tables[table], error: null}).then(resolve,reject) };
      for (const method of ['select','eq','maybeSingle','order','limit','single']) b[method] = () => b;
      b.insert = () => { calls.push(`insert:${table}`); return b; };
      return b;
    },
    rpc: async (name,args) => {
      calls.push([name,args]);
      return { error:null,data:options.actionResult ?? {outcome:'saved',remaining:0} };
    },
  };
  const modules = {
    'next/server': { NextResponse: { json:(body,init) => Response.json(body,init) } },
    '@/lib/request-rate-limit': { checkRouteRateLimit:async () => ({allowed:true}), extractClientIp:() => 'local' },
    '@/lib/supabase/request': { getRequestAuthContext:async () => ({user: {id:me}}) },
    '@/lib/supabase/server': { createAdminClient:() => client },
    '@/lib/dating-viewer-sex': { resolveDatingViewerSex:async () => ({status:'resolved',targetSex:'male'}) },
    '@/lib/dating-blocks': { hasDatingBlockBetween:async () => Boolean(options.blocked) },
    '@/lib/dating-contact-blocks': { hasDatingContactBlockBetween:async () => false },
    '@/lib/dating-notifications': { notifyDatingUser:async () => { calls.push('notify'); } },
    '@/lib/dating-match-metrics': { recordDatingMatchEvent:async () => { calls.push('match'); } },
    '@/lib/dating-chat': { ensureDatingChatThread:async () => { calls.push('chat'); } },
    '@/lib/dating-swipe': {
      getLovePassSwipeStatus:async () => options.lovePass ?? null, LOVE_PASS_SWIPE_LIKE_LIMIT:50,
      getSwipeLimitInfo:async () => ({limit:options.legacyLimit ?? 5,activeSubscription:options.legacyLimit ? {id:'legacy'} : null}),
      getSwipeDailyUsage:async () => { calls.push('legacyUsage'); return options.used ?? 0; },
      getLatestSwipeCardForUser:async () => ({id:myCard,instagram_id:'mine',display_nickname:'회원'}),
      getSwipeCandidate:async () => ({user_id:peer,card_id:peerCard}),
      getSwipeDayRangeUtc:() => ({startUtcIso:new Date(0).toISOString()}),
      sendDatingEmailNotification:async () => { calls.push('send'); return true; },
    },
  };
  const file = 'app/api/dating/cards/swipe/route.ts';
  const m = {exports:{}};
  const source = ts.transpileModule(read(file), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',source)(key => modules[key] || require(key),m,m.exports);
  const url = 'http://127.0.0.1/api/dating/cards/swipe?sex=male';
  return {
    calls,
    get: () => m.exports.GET(new Request(url)),
    post: action => m.exports.POST(new Request(url,{method:'POST',body:JSON.stringify({sex:'male',action,target_user_id:peer,target_card_id:peerCard})})),
  };
}

test('real route exposes more browsing at zero likes, leaves legacy daily limit intact and guards block/retry actions', async () => {
  const paid = mockedSwipeRoute({lovePass:{remaining:0}});
  assert.deepEqual(await (await paid.get()).json(), {loggedIn:true,canSwipe:true,remaining:0,limit:50,
    candidate:{user_id:peer,card_id:peerCard},unlimitedPass:true,reason:null});
  assert.deepEqual(await (await paid.post('pass')).json(), {ok:true,remaining:0,limit:50,unlimitedPass:true,match:null});
  assert.deepEqual(paid.calls, [['record_dating_love_pass_swipe', {p_user_id:me,p_actor_card_id:myCard,p_target_user_id:peer,p_target_card_id:peerCard,p_target_sex:'male',p_action:'pass'}]]);

  const limited = mockedSwipeRoute({lovePass:{remaining:0},actionResult:{outcome:'limited',remaining:0}});
  const response = await limited.post('like');
  assert.equal(response.status,429);
  assert.equal((await response.json()).unlimitedPass,true);
  assert.ok(!limited.calls.includes('notify'));

  const blocked = mockedSwipeRoute({lovePass:{remaining:12},blocked:true});
  assert.equal((await blocked.post('like')).status,403);
  assert.deepEqual(blocked.calls,[]);

  const legacy = mockedSwipeRoute({used:5});
  const legacyState = await (await legacy.get()).json();
  assert.equal(legacyState.canSwipe,false);
  assert.equal(legacyState.candidate,null);
  assert.equal(legacyState.unlimitedPass,undefined);
  assert.equal((await legacy.post('pass')).status,429);
  assert.deepEqual(legacy.calls,['legacyUsage','legacyUsage']);

  const oldPlus = mockedSwipeRoute({legacyLimit:30,used:29});
  const oldPlusState = await (await oldPlus.get()).json();
  assert.equal(oldPlusState.remaining,1);
  assert.equal(oldPlusState.unlimitedPass,undefined);
  assert.deepEqual(await (await oldPlus.post('pass')).json(), {ok:true,remaining:0,limit:30,match:null});
  assert.deepEqual(oldPlus.calls,['legacyUsage','legacyUsage','insert:dating_card_swipes']);
});
