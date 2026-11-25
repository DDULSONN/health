/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated PostgreSQL role/RLS checks; no env files or network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/sql/dating_open_card_member_only.sql'), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const viewer = id(1), owner = id(2);
const regular = id(11), restricted = id(12), pending = id(13), expired = id(14);

async function withDb(fn) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
      $$;
      grant usage on schema auth to anon, authenticated, service_role;
      create table public.dating_cards(
        id uuid primary key, owner_user_id uuid not null, status text not null,
        expires_at timestamptz, display_nickname text not null default '가상 카드'
      );
      alter table public.dating_cards enable row level security;
      grant select on public.dating_cards to anon, authenticated, service_role;
      grant insert, update on public.dating_cards to authenticated, service_role;
      create policy dating_cards_public_select on public.dating_cards for select to anon, authenticated
        using (status='public' and expires_at>now());
      create policy dating_cards_owner_select on public.dating_cards for select to authenticated using (owner_user_id=auth.uid());
      create policy dating_cards_owner_insert on public.dating_cards for insert to authenticated with check (owner_user_id=auth.uid());
      create policy dating_cards_owner_update on public.dating_cards for update to authenticated
        using (owner_user_id=auth.uid()) with check (owner_user_id=auth.uid());
      insert into public.dating_cards(id,owner_user_id,status,expires_at) values
        ('${regular}','${viewer}','public',now()+interval '1 day'),
        ('${restricted}','${owner}','public',now()+interval '1 day'),
        ('${pending}','${owner}','pending',null),
        ('${expired}','${owner}','public',now()-interval '1 day');`);
    await db.exec(migration);
    const as = async (role, user, run) => {
      assert(['anon','authenticated','service_role'].includes(role));
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user??'']);
      await db.exec(`set role ${role}`);
      try { return await run(); } finally { await db.exec('reset role'); }
    };
    const selectIds = async () => (await db.query('select id from public.dating_cards order by id')).rows.map(r=>r.id);
    await fn({ db, as, selectIds });
  } finally { await db.close(); }
}

test('member-only RLS excludes exactly the flagged card for anon and preserves existing public/owner rules',()=>withDb(async ({db,as,selectIds})=>{
  assert.deepEqual((await db.query('select distinct members_only from dating_cards')).rows,[{members_only:false}]);
  assert.deepEqual(await as('anon',null,selectIds),[regular,restricted]);
  await as('service_role',null,()=>db.query('update dating_cards set members_only=true where id=$1',[restricted]));
  assert.deepEqual(await as('anon',null,selectIds),[regular]);
  assert.deepEqual(await as('authenticated',viewer,selectIds),[regular,restricted]);
  assert.deepEqual(await as('authenticated',owner,selectIds),[regular,restricted,pending,expired]);
  assert.deepEqual(await as('service_role',null,selectIds),[regular,restricted,pending,expired]);
  // Even another permissive policy cannot OR its way around the restriction.
  await db.exec('create policy extra_legacy_guest_select on dating_cards for select to anon using (true)');
  assert.deepEqual(await as('anon',null,selectIds),[regular,pending,expired]);
}));

test('existing authenticated owner edits still work, but guests and members cannot change a restriction or insert it',()=>withDb(async ({db,as})=>{
  await as('service_role',null,()=>db.query('update dating_cards set members_only=true where id=$1',[restricted]));
  const denied = {code:'42501',message:/managed by the operator/};
  await as('authenticated',owner,async()=>{
    const edit=await db.query("update dating_cards set display_nickname='정상 수정',members_only=true where id=$1 returning display_nickname,members_only",[restricted]);
    assert.deepEqual(edit.rows,[{display_nickname:'정상 수정',members_only:true}]);
    await assert.rejects(db.query('update dating_cards set members_only=false where id=$1',[restricted]),denied);
    await assert.rejects(db.query('update dating_cards set members_only=null where id=$1',[restricted]),denied);
    await assert.rejects(db.query("insert into dating_cards(id,owner_user_id,status,members_only) values($1,$2,'pending',true)",[id(15),owner]),denied);
    const inserted=await db.query("insert into dating_cards(id,owner_user_id,status) values($1,$2,'pending') returning members_only",[id(15),owner]);
    assert.deepEqual(inserted.rows,[{members_only:false}]);
  });
  await as('authenticated',viewer,async()=>{
    await assert.rejects(db.query('update dating_cards set members_only=true where id=$1',[regular]),denied);
    assert.equal((await db.query('update dating_cards set members_only=false where id=$1 returning id',[restricted])).rows.length,0);
  });
  // Simulate an unexpectedly permissive legacy guest write policy and grant;
  // even then the new column cannot be set to true by a guest INSERT/UPDATE.
  await db.exec(`grant insert,update on dating_cards to anon;
    create policy synthetic_guest_insert on dating_cards for insert to anon with check (true);
    create policy synthetic_guest_update on dating_cards for update to anon using (true) with check (true);`);
  await as('anon',null,async()=>{
    await assert.rejects(db.query("insert into dating_cards(id,owner_user_id,status,members_only) values($1,$2,'pending',true)",[id(16),viewer]),denied);
    await assert.rejects(db.query('update dating_cards set members_only=true where id=$1',[regular]),denied);
  });
  const kept=await db.query('select members_only from dating_cards where id=$1',[restricted]);
  assert.deepEqual(kept.rows,[{members_only:true}]);
}));

test('migration is repeatable, preserves data and keeps one restrictive policy and one trigger',()=>withDb(async ({db,as})=>{
  const snapshot = () => db.query('select * from dating_cards order by id');
  const before = await snapshot();
  await as('service_role',null,()=>db.query('update dating_cards set members_only=true where id=$1',[restricted]));
  const changed = await snapshot();
  assert.deepEqual(changed.rows.map(r=>({...r,members_only:false})), before.rows);
  await db.exec(migration);
  assert.deepEqual(await snapshot(),changed);
  const acl = await db.query(`select permissive,cmd,roles::text
    from pg_catalog.pg_policies where schemaname='public' and tablename='dating_cards'
      and policyname='dating_cards_members_only_anon'`);
  assert.deepEqual(acl.rows,[{permissive:'RESTRICTIVE',cmd:'SELECT',roles:'{anon}'}]);
  const trigger = await db.query(`select count(*)::int n from pg_catalog.pg_trigger
    where tgrelid='public.dating_cards'::regclass and tgname='dating_cards_guard_members_only'`);
  assert.deepEqual(trigger.rows,[{n:1}]);
  const serviceDisable=await as('service_role',null,()=>db.query('update dating_cards set members_only=false where id=$1 returning members_only',[restricted]));
  assert.deepEqual(serviceDisable.rows,[{members_only:false}]);
}));
