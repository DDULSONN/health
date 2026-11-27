/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");
const ts = require("typescript");

const migration = readFileSync(path.join(__dirname, "../supabase/sql/dating_1on1_winter_candidate_alerts.sql"), "utf8");
const USER = "7daf880a-6dcb-4587-836e-71582c2a172d";
const OTHER = "8dad6a3e-395b-4a4b-be3a-1fa413727bce";
const CARD = "844efe55-c671-48f7-8802-652ff2d12dd7";
const OTHER_CARD = "f6293453-3235-4699-a1bc-2534db5bc637";
const TODAY = "(now() at time zone 'Asia/Seoul')::date";
const DAY = "2026-11-27";

function route(file, stubs, env = {}) {
  const output = ts.transpileModule(readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  const imports = { "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } }, ...stubs };
  new Function("require", "module", "exports", "process", output)(name => imports[name] ?? require(name), mod, mod.exports, { env });
  return mod.exports;
}

test("alert API only enables the authenticated user's eligible empty state and performs no delivery", async () => {
  const actions = [];
  let q = { count: 0, claimed: true, repeated: true }, loggedIn = true, originAllowed = true;
  const handler = route("app/api/dating/1on1/recommendations/expand/alert/route.ts", {
    "@/lib/dating-1on1-expansion": { isWinterExpansionEnabled: () => true },
    "@/lib/dating-1on1-winter-expansion": { readOneOnOneWinterAvailability: async (_admin, user, card) => {
      assert.equal(user.id, USER);
      assert.equal(card, CARD);
      return q;
    } },
    "@/lib/request-origin": { ensureAllowedMutationOrigin: () => originAllowed ? null : new Response(null, { status: 403 }) },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: loggedIn ? { id: USER } : null }) },
    "@/lib/supabase/server": { createAdminClient: () => ({ rpc: async (name, args) => {
      actions.push([name, args]); return { data: args.p_enabled };
    } }) },
  });
  const post = enabled => handler.POST(new Request("https://gym.invalid/api/alerts", {
    method: "POST", body: JSON.stringify({ source_card_id: CARD, enabled, user_id: OTHER }),
  }));
  assert.equal((await post(true)).status, 200); // incl. previous completed empty daily batch
  q = { count: 2, claimed: false, repeated: true };
  assert.equal((await post(true)).status, 409);
  assert.equal((await post(false)).status, 200);
  loggedIn = false;
  assert.equal((await post(true)).status, 401);
  loggedIn = true; originAllowed = false;
  assert.equal((await post(true)).status, 403);
  assert.deepEqual(actions, [true, false].map(enabled => ["set_dating_1on1_winter_alert", {
    p_user: USER, p_card: CARD, p_enabled: enabled,
  }]));
});

test("authorized cron delivers only current, visible winter inventory to registered candidates", async () => {
  const actions = [];
  const handler = route("app/api/cron/dating-1on1-winter-candidates/route.ts", {
    "@/lib/dating-1on1-expansion": { isWinterExpansionEnabled: () => true },
    "@/lib/weekly": { getKstDateString: () => DAY },
    "@/lib/dating-1on1-winter-expansion": { readOneOnOneWinterAvailability: async (_admin, user, _card, expectedDay) => {
      assert.equal(expectedDay, DAY);
      return { count: user.id === OTHER ? 0 : 2, claimed: false, repeated: true };
    } },
    "@/lib/supabase/server": { createAdminClient: () => ({ rpc: async (name, args) => {
      actions.push([name, args]);
      return name === "claim_dating_1on1_winter_alert_checks"
        ? { data: [{ user_id: USER, source_card_id: CARD, request_id: CARD }, { user_id: OTHER, source_card_id: OTHER_CARD, request_id: OTHER_CARD }] }
        : { data: true };
    } }) },
  }, { CRON_SECRET: "test-secret-for-local-fake" });
  const req = bearer => new Request("https://gym.invalid/api/cron", { headers: { Authorization: bearer } });
  assert.equal((await handler.GET(req("Bearer not-authorized"))).status, 401);
  assert.deepEqual(actions, []);
  const result = await handler.GET(req("Bearer test-secret-for-local-fake"));
  assert.deepEqual(await result.json(), { ok: true, checked: 2, sent: 1, errors: 0 });
  assert.deepEqual(actions, [
    ["claim_dating_1on1_winter_alert_checks", { p_limit: 12 }],
    ["deliver_dating_1on1_winter_alert", { p_user: USER, p_card: CARD, p_request: CARD, p_day: DAY }],
  ]);
});

test("winter site's one-shot alert opt-in, ownership, races and expiry (local Postgres)", async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create table public.profiles(user_id uuid primary key, phone_e164 text, is_banned boolean default false);
      create table public.dating_1on1_cards(id uuid primary key,user_id uuid not null,status text not null);
      create table public.dating_1on1_expansion_batches(user_id uuid,day_key date);
      create table public.notifications(user_id uuid,type text,meta_json jsonb);
      grant select on public.profiles,public.dating_1on1_cards,public.dating_1on1_expansion_batches to service_role;
      grant insert on public.notifications to service_role;
      insert into auth.users values ('${USER}'),('${OTHER}');
      insert into public.profiles values ('${USER}','+820000000000',false),('${OTHER}',null,false);
      insert into public.dating_1on1_cards values ('${CARD}','${USER}','approved'),('${OTHER_CARD}','${OTHER}','approved');
    `);
    await db.exec(migration);
    await db.exec(migration); // safe reapply

    const set = async (user, card, enabled) => (await db.query(
      "select public.set_dating_1on1_winter_alert($1,$2,$3) as enabled", [user, card, enabled],
    )).rows[0].enabled;
    const claim = async () => (await db.query("select * from public.claim_dating_1on1_winter_alert_checks(12)")).rows;
    const deliver = async (req, day = TODAY) => (await db.query(
      `select public.deliver_dating_1on1_winter_alert($1,$2,$3,${day}) as sent`,
      [req.user_id, req.source_card_id, req.request_id],
    )).rows[0].sent;

    await t.test("records stay service-only; other account and missing verification cannot enable", async () => {
      await db.exec("set role authenticated");
      await assert.rejects(set(USER, CARD, true), /permission denied/);
      await assert.rejects(db.query("select * from public.dating_1on1_winter_candidate_alerts"), /permission denied/);
      await db.exec("reset role; set role service_role");
      assert.equal(await set(OTHER, CARD, true), false);
      assert.equal(await set(OTHER, OTHER_CARD, true), false);
      assert.deepEqual(await claim(), []);
    });
    await t.test("repeat opt-in is idempotent; claims and opt-out suppress a stale worker", async () => {
      assert.equal(await set(USER, CARD, true), true);
      const [first] = await claim();
      assert.equal(first.user_id, USER);
      assert.equal(await set(USER, CARD, true), true);
      assert.deepEqual(await claim(), []);
      assert.equal(await set(USER, CARD, false), false);
      assert.equal(await deliver(first), false);
      assert.equal(await set(USER, CARD, true), true);
      const [next] = await claim();
      assert.notEqual(next.request_id, first.request_id);
      assert.equal(await deliver(first), false);
      assert.equal(await deliver(next, `(${TODAY}-1)`), false);
    });
    await t.test("opened expansion, banned or expired members cannot receive a notice", async () => {
      await db.exec("reset role");
      const [row] = (await db.query("select * from public.dating_1on1_winter_candidate_alerts")).rows;
      await db.exec(`insert into public.dating_1on1_expansion_batches values ('${USER}',${TODAY})`);
      assert.equal(await deliver(row), false);
      await db.exec("delete from public.dating_1on1_expansion_batches; update public.profiles set is_banned=true");
      assert.equal(await deliver(row), false);
      await db.exec("update public.profiles set is_banned=false; update public.dating_1on1_winter_candidate_alerts set requested_at=now()-interval '8 days',next_check_at=now()");
      assert.deepEqual(await claim(), []);
      assert.equal(await deliver(row), false);
    });
    await t.test("successful claim inserts exactly one internal notification and consumes the opt-in", async () => {
      await db.exec("set role service_role");
      assert.equal(await set(USER, CARD, true), true);
      const [row] = await claim();
      assert.equal(await deliver(row), true);
      assert.equal(await deliver(row), false);
      assert.deepEqual(await claim(), []);
      await db.exec("reset role");
      const notifications = (await db.query("select user_id,meta_json from public.notifications")).rows;
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0].user_id, USER);
      assert.equal(notifications[0].meta_json.notification_type, "dating_1on1_winter_candidate_ready");
      assert.equal(notifications[0].meta_json.notification_route, "/community/dating/cards?tab=one_on_one#one-on-one-winter-candidates");
      assert.equal(Object.hasOwn(notifications[0].meta_json, "candidate_id"), false);
    });
  } finally {
    await db.close();
  }
});
