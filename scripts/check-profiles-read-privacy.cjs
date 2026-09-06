/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file, imports) {
  const code = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)(imports, mod, mod.exports);
  return mod.exports;
}

async function checkApplication() {
  const calls = [];
  const query = { in: () => query };
  const helper = load("lib/public-profiles.ts", (id) => {
    if (id === "server-only") return {};
    assert.equal(id, "@/lib/supabase/server");
    return { createAdminClient: () => ({ from(table) {
      calls.push(table);
      return { select(columns) { calls.push(columns); return query; } };
    } }) };
  });
  assert.equal(helper.selectPublicProfiles(), query);
  assert.deepEqual(calls, ["profiles", "user_id,nickname,role"]);
  assert.match(read("lib/public-profiles.ts"), /import "server-only"/);

  const migrated = [
    "body-eval/mail/inbox", "body-eval/mail/thread", "bodycheck/home-vote",
    "notifications", "posts", "posts/[id]", "rankings", "rankings/weekly-bodycheck", "weekly-winners",
  ];
  for (const route of migrated) {
    const source = read(`app/api/${route}/route.ts`);
    assert.match(source, /selectPublicProfiles\(\)/, route);
    assert.doesNotMatch(source, /selectPublicProfiles\(\)\s*\.(?:update|insert|delete|upsert)\(/);
  }
  assert.doesNotMatch(read("app/admin/page.tsx"), /profiles\(nickname\)/);
  assert.match(read("app/admin/page.tsx"), /fetch\("\/api\/admin\/posts"/);
  assert.match(read("app/admin/page.tsx"), /fetch\("\/api\/admin\/me"/);

  let authorized = false;
  let dbCalls = 0;
  let failProfiles = false;
  const denial = { status: 403 };
  const route = load("app/api/admin/posts/route.ts", (id) => {
    if (id === "next/server") return { NextResponse: { json: (body, options = {}) => ({ body, ...options }) } };
    assert.equal(id, "@/lib/admin-route");
    return { requireAdminRoute: async () => authorized ? { ok: true, admin: { from(table) {
      dbCalls++;
      const q = { select(columns) {
        if (table === "profiles") assert.equal(columns, "user_id,nickname");
        return q;
      }, order: () => q, limit: (n) => { assert.equal(n, 50); return q; },
      in: (column, ids) => { assert.equal(column, "user_id"); assert.deepEqual(ids, ["author"]); return q; },
      then(resolve) { return Promise.resolve(resolve(table === "posts"
        ? { data: [{ id: "post", user_id: "author", title: "한글 제목" }], error: null }
        : { data: [{ user_id: "author", nickname: "작성자" }], error: failProfiles ? { message: "failed" } : null })); } };
      return q;
    } } } : { ok: false, response: denial } };
  });
  assert.equal(await route.GET(), denial);
  assert.equal(dbCalls, 0, "Unauthorized requests must not touch admin DB");
  authorized = true;
  const result = await route.GET();
  assert.deepEqual(result.body.posts[0].profiles, { nickname: "작성자" });
  assert.equal(result.headers["Cache-Control"], "private, no-store");
  failProfiles = true;
  assert.equal((await route.GET()).status, 500);
  console.log("PASS: fixed public projection, migrated callers, admin denial/success/error and Korean output");
}

async function checkDatabase() {
  // Isolated PostgreSQL WASM engine only. Never connects to the live database.
  const { PGlite } = require(process.env.PRIVACY_TEST_PGLITE_PATH || "@electric-sql/pglite");
  const db = new PGlite();
  const a = "00000000-0000-4000-8000-000000000001";
  const b = "00000000-0000-4000-8000-000000000002";
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
        user_id uuid primary key, nickname text not null, role text default 'user',
        email text, phone_e164 text, phone_verified boolean default false,
        phone_verified_at timestamptz, is_banned boolean default false,
        banned_reason text, swipe_profile_visible boolean default true,
        nickname_changed_count integer default 0, nickname_changed_at timestamptz,
        nickname_change_credits integer default 0
      );
      grant select, insert, update, delete on public.profiles to anon, authenticated, service_role;
      alter table public.profiles enable row level security;
      create policy profiles_select_public on public.profiles for select using (true);
      create policy legacy_extra_select on public.profiles for select using (true);
      create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = user_id);
      create policy profiles_update_own on public.profiles for update using (auth.uid() = user_id);
      insert into public.profiles (user_id,nickname,email,phone_e164) values
        ('${a}', '본인', 'a@example.test', '+821000000001'),
        ('${b}', '다른회원', 'b@example.test', '+821000000002');
    `);
    const asRole = async (role, uid, sql) => {
      await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid}', false);`);
      try { return await db.query(sql); } finally { await db.exec("reset role;"); }
    };
    assert.equal((await asRole("anon", "", "select email,phone_e164 from public.profiles")).rows.length, 2);
    const nicknamePolicy = read("supabase/sql/profile_nickname_change.sql").split('-- RLS: direct update')[1];
    await db.exec(nicknamePolicy.slice(nicknamePolicy.indexOf('drop policy')));
    const migration = read("supabase/sql/profiles_read_privacy_hardening.sql");
    await db.exec(migration);
    await db.exec(migration); // Re-running must remain safe.
    assert.equal((await asRole("anon", "", "select * from public.profiles")).rows.length, 0);
    assert.equal((await asRole("authenticated", "", "select * from public.profiles")).rows.length, 0);
    const self = (await asRole("authenticated", a, "select * from public.profiles")).rows;
    assert.equal(self.length, 1);
    assert.equal(self[0].email, "a@example.test");
    assert.equal((await asRole("authenticated", a, `select email,phone_e164 from public.profiles where user_id='${b}'`)).rows.length, 0);
    assert.equal((await asRole("authenticated", a, `select count(*)::int as n from public.profiles where phone_e164='+821000000002'`)).rows[0].n, 0);
    assert.equal((await asRole("service_role", "", "select email,phone_e164 from public.profiles")).rows.length, 2);
    // Existing self-update, including the deployed nickname-limited policy.
    await assert.rejects(asRole("authenticated", a, `update public.profiles set nickname='우회' where user_id='${a}' returning user_id`), /row-level security/);
    await assert.rejects(asRole("authenticated", a, `update public.profiles set nickname_change_credits=999 where user_id='${a}' returning user_id`), /row-level security/);
    assert.equal((await asRole("authenticated", a, `update public.profiles set swipe_profile_visible=false where user_id='${a}' returning user_id`)).rows.length, 1);
    assert.equal((await asRole("authenticated", a, `update public.profiles set phone_verified=true,phone_verified_at=now() where user_id='${a}' returning phone_verified`)).rows[0].phone_verified, true);
    assert.equal((await asRole("authenticated", a, `update public.profiles set swipe_profile_visible=false where user_id='${b}' returning user_id`)).rows.length, 0);
    const c = "00000000-0000-4000-8000-000000000003";
    assert.equal((await asRole("authenticated", c, `insert into public.profiles(user_id,nickname) values('${c}','신규회원') returning user_id`)).rows.length, 1);
    await asRole("service_role", "", `update public.profiles set is_banned=true where user_id='${b}'`);
    assert.equal((await asRole("authenticated", b, "select is_banned from public.profiles")).rows[0].is_banned, true);
    await db.exec(read("supabase/sql/profiles_read_privacy_verify.sql"));
    console.log("PASS: SQL applied twice; anonymous/other-user/count leaks blocked; self reads, signup, phone sync, visibility updates and server access preserved");
  } finally { await db.close(); }
}

(async () => { await checkApplication(); await checkDatabase(); })().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
