/* eslint-disable @typescript-eslint/no-require-imports */
// Offline PostgreSQL tests only: no environment loading, network or real users.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PRIVACY_TEST_PGLITE_PATH || '@electric-sql/pglite');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

(async () => {
  const db = new PGlite();
  let checks = 0;
  const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
  const asRole = async (role, user, sql) => {
    await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user}', false);`);
    try { return (await db.query(sql)).rows; } finally { await db.exec('reset role;'); }
  };
  const blocked = async (role, user, sql, label) => {
    await assert.rejects(asRole(role, user, sql), (error) => error.code === '42501', label);
    checks++;
  };
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      create table public.profiles (
        id uuid primary key default gen_random_uuid(), user_id uuid unique not null,
        nickname text not null, role text default 'user', email text,
        phone_e164 text, phone_verified boolean default false, phone_verified_at timestamptz,
        is_banned boolean default false, banned_reason text,
        swipe_profile_visible boolean default true, push_token text,
        nickname_changed_count integer default 0, nickname_changed_at timestamptz,
        nickname_change_credits integer default 0
      );
      grant select, insert, update, delete on public.profiles to anon, authenticated, service_role;
      alter table public.profiles enable row level security;
      create policy profiles_select_public on public.profiles for select using (true);
      create policy "Profiles are updatable by owner" on public.profiles
        for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
      create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = user_id);
      create policy profiles_update_own_limited on public.profiles for update to authenticated
        using (auth.uid() = user_id) with check (auth.uid() = user_id);
      insert into public.profiles (id,user_id,nickname,email,phone_e164) values
        ('${uid(1)}','${uid(1)}','본인','a@example.test','+821000000001'),
        ('${uid(22)}','${uid(2)}','상대','b@example.test','+821000000002');
      create table public.dating_1on1_cards (user_id uuid, phone text);
      insert into public.dating_1on1_cards values ('${uid(2)}','FAKE-NOT-A-PHONE');
      grant select on public.dating_1on1_cards to authenticated, service_role;
      alter table public.dating_1on1_cards enable row level security;
      create policy cards_admin on public.dating_1on1_cards for select to authenticated
        using (exists (select 1 from public.profiles p where p.user_id=auth.uid() and p.role='admin'));
    `);
    await db.exec(read('supabase/sql/profiles_read_privacy_hardening.sql'));
    // Reproduce the observed vulnerability before the fix, using fake data.
    check((await asRole('authenticated', uid(1), 'select phone from public.dating_1on1_cards')).length, 0, 'initially private');
    await asRole('authenticated', uid(1), `update public.profiles set role='admin' where user_id='${uid(1)}'`);
    check((await asRole('authenticated', uid(1), 'select phone from public.dating_1on1_cards')).length, 1, 'pre-fix escalation reproduced');
    await db.exec(`update public.profiles set role='user' where user_id='${uid(1)}'`);

    const migration = read('supabase/sql/profiles_authority_write_guard.sql');
    await db.exec(migration);
    await db.exec(migration);
    const own = `where user_id='${uid(1)}'`;
    for (const patch of ["role='admin'", 'role=null', `id='${uid(33)}'`, `user_id='${uid(3)}'`]) {
      await blocked('authenticated', uid(1), `update public.profiles set ${patch} ${own}`, patch);
    }
    await blocked('authenticated', uid(3), `insert into public.profiles(user_id,nickname,role) values('${uid(3)}','조작','admin')`, 'privileged signup');
    await blocked('authenticated', uid(1), `insert into public.profiles(user_id,nickname,role) values('${uid(1)}','본인','admin') on conflict(user_id) do update set role=excluded.role`, 'privileged upsert');
    await blocked('authenticated', uid(3), `insert into public.profiles(user_id,nickname) values('${uid(4)}','다른 소유자')`, 'foreign insert');
    await blocked('anon', '', `insert into public.profiles(user_id,nickname) values('${uid(3)}','비로그인')`, 'anonymous insert');
    await blocked('authenticated', '', `insert into public.profiles(user_id,nickname) values('${uid(3)}','주체 없음')`, 'missing JWT subject');

    // A forged profile/metadata claim must not turn an authenticated DB role into service_role.
    await db.exec(`select set_config('request.jwt.claim.role','service_role',false)`);
    await blocked('authenticated', uid(1), `update public.profiles set role='admin' ${own}`, 'JWT claim is not trusted');
    await db.exec(`select set_config('request.jwt.claim.role','authenticated',false)`);
    check((await asRole('authenticated', uid(1), 'select phone from public.dating_1on1_cards')).length, 0, 'raw card phone remains blocked');
    check((await asRole('authenticated', uid(1), `select * from public.profiles where user_id='${uid(2)}'`)).length, 0, 'other profile still private');
    check((await asRole('anon', '', 'select * from public.profiles')).length, 0, 'anonymous reads still private');
    check((await asRole('authenticated', uid(1), `select role from public.profiles ${own}`))[0].role, 'user', 'failed writes did not change role');

    // Production's current phone sync still writes as the authenticated owner.
    check((await asRole('authenticated', uid(1), `update public.profiles set phone_e164='+821000000001',phone_verified=true,phone_verified_at=now() ${own} returning phone_verified`))[0].phone_verified, true, 'current phone verification write preserved');
    check((await asRole('authenticated', uid(1), `update public.profiles set swipe_profile_visible=false,push_token='fake-token' ${own} returning swipe_profile_visible`))[0].swipe_profile_visible, false, 'settings and push token preserved');
    check((await asRole('authenticated', uid(1), `update public.profiles set role=role,id=id,user_id=user_id ${own} returning user_id`)).length, 1, 'no-op authority writes allowed');
    check((await asRole('authenticated', uid(3), `insert into public.profiles(user_id,nickname) values('${uid(3)}','신규회원') returning role`))[0].role, 'user', 'onboarding defaults preserved');
    check((await asRole('authenticated', uid(3), `insert into public.profiles(user_id,nickname) values('${uid(3)}','신규회원') on conflict(user_id) do update set nickname=excluded.nickname returning role`))[0].role, 'user', 'ordinary upsert preserved');
    check((await asRole('authenticated', uid(1), `update public.profiles set phone_verified=true where user_id='${uid(2)}' returning user_id`)).length, 0, 'foreign write still denied');

    // Server-authorized admin actions, nickname changes and phone completion still work.
    await asRole('service_role', '', `update public.profiles set role='admin',nickname='운영자',is_banned=true,phone_verified=true where user_id='${uid(2)}'`);
    check((await asRole('authenticated', uid(2), 'select phone from public.dating_1on1_cards')).length, 1, 'legitimate admin DB reads preserved');
    check((await asRole('service_role', '', 'select phone from public.dating_1on1_cards'))[0].phone, 'FAKE-NOT-A-PHONE', 'server contact exchange access preserved');
    await db.exec(`
      create function public.test_trusted_signup() returns void language sql security definer set search_path='' as
        $$ insert into public.profiles(user_id,nickname) values('${uid(5)}','인증 가입') $$;
      grant execute on function public.test_trusted_signup() to authenticated;
    `);
    await asRole('authenticated', uid(5), 'select public.test_trusted_signup()');
    check((await asRole('authenticated', uid(5), 'select role from public.profiles'))[0].role, 'user', 'trusted signup trigger path preserved');

    // Even a legacy permissive policy cannot bypass the trigger's ownership guard.
    await db.exec('create policy test_legacy_all on public.profiles for all using (true) with check (true)');
    await blocked('authenticated', uid(1), `update public.profiles set user_id='${uid(6)}' ${own}`, 'legacy policy cannot reassign owner');
    await blocked('authenticated', uid(1), `insert into public.profiles(user_id,nickname) values('${uid(6)}','타인')`, 'legacy policy cannot insert another owner');
    await blocked('authenticated', uid(1), `insert into public.profiles(user_id,nickname,role) values('${uid(1)}','본인','user') on conflict(user_id) do update set role='admin'`, 'upsert update guard');
    check((await db.query(`select count(*)::int n from pg_trigger where tgname='profiles_guard_authority_write' and not tgisinternal`)).rows[0].n, 1, 'idempotent trigger installation');
    await db.exec(read('supabase/sql/profiles_authority_write_guard_verify.sql'));
    console.log(`PASS: ${checks} offline PostgreSQL checks; escalation blocked; signup/settings/phone/server contact paths preserved.`);
  } finally { await db.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
