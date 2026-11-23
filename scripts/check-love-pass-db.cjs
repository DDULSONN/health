/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PGlite } = require("@electric-sql/pglite");

const UID = "10000000-0000-4000-8000-000000000001";
const PEER = "10000000-0000-4000-8000-000000000002";
const OTHER = "10000000-0000-4000-8000-000000000003";
const MY_CARD = "20000000-0000-4000-8000-000000000001";
const PEER_CARD = "20000000-0000-4000-8000-000000000002";
const PEER_CARD_2 = "20000000-0000-4000-8000-000000000003";
const PEER_CARD_3 = "20000000-0000-4000-8000-000000000004";
const ORDER = "test_lovepass_order1";
const KEY = "local-verification-provider-key";
const sql = fs.readFileSync(path.join(__dirname, "../supabase/sql/dating_love_pass.sql"), "utf8");

const setup = `
  create role service_role bypassrls;
  create role authenticated;
  create role anon;
  create schema auth;
  create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
  create table public.profiles(user_id uuid primary key,phone_verified boolean,is_banned boolean);
  create table public.site_settings(key text primary key,value_json jsonb);
  create table public.toss_test_payment_orders (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id),
    product_type text not null check (product_type in ('apply_credits','one_on_one_contact_exchange','one_on_one_plus_30d','dating_all_pass_30d','custom_installed_product')),
    product_meta jsonb not null default '{}',
    toss_order_id text not null unique,
    order_name text not null,
    amount int not null,
    status text not null default 'ready' check(status in ('ready','paid','canceled','failed')),
    payment_key text,approved_at timestamptz,raw_response jsonb,updated_at timestamptz not null default now()
  );
  alter table public.toss_test_payment_orders enable row level security;
  grant select,insert,update,delete on public.toss_test_payment_orders to authenticated;
  create policy old_owner on public.toss_test_payment_orders for all to authenticated using (true) with check (true);
  create table public.dating_cards (
    id uuid primary key, owner_user_id uuid not null references auth.users(id),
    sex text not null default 'male', age int not null default 25, region text not null default '서울 서초구',
    instagram_id text not null default 'local_verification', status text not null default 'pending',
    published_at timestamptz, expires_at timestamptz, created_at timestamptz not null default now(),
    photo_visibility text not null default 'blur',photo_paths jsonb not null default '[]'::jsonb,
    blur_paths jsonb not null default '[]'::jsonb,blur_thumb_path text
  );
  grant insert,update,select on public.dating_cards to authenticated;
  create table public.dating_card_applications (
    id uuid primary key default gen_random_uuid(), card_id uuid not null references public.dating_cards(id),
    applicant_user_id uuid not null references auth.users(id), applicant_display_nickname text not null,
    age int not null check (age between 19 and 99), height_cm int,region text,job text,training_years int,
    intro_text text not null,instagram_id text not null,photo_paths jsonb not null check (jsonb_array_length(photo_paths)=2),
    status text not null, unique(card_id,applicant_user_id)
  );
  create table public.user_daily_apply_usage(user_id uuid not null,kst_date date not null,base_used int not null,updated_at timestamptz,primary key(user_id,kst_date));
  create table public.user_apply_credits(user_id uuid primary key,credits int not null,updated_at timestamptz);
  create table public.dating_profile_review_jobs(
    card_id uuid,source_type text,user_id uuid,payload jsonb,state text,resolution text,result jsonb
  );
  create table public.dating_profile_review_settings(singleton bool primary key,initial_open_card_payloads jsonb);
  create function public.dating_profile_review_payload(text,jsonb) returns jsonb language sql stable as
    'select jsonb_build_object(''region'',$2->''region'',''photos'',$2->''photo_paths'')';
  create function public.get_daily_apply_base_limit(date) returns int language sql stable as 'select 2';
`;

const approvedAt = new Date().toISOString();
const receipt = (changes = {}) => ({ status: "DONE", totalAmount: 30000, orderId: ORDER, paymentKey: KEY, approvedAt, ...changes });
const finish = (db, proof = receipt()) => db.query(
  "select public.activate_dating_love_pass($1,$2,$3,$4::jsonb) val", [ORDER, KEY, approvedAt, proof],
).then((r) => r.rows[0].val);
const take = (db, cardId, ownerId, province, changes = {}) => db.query(`
  select public.submit_dating_love_pass_application($1,$2,$3,'서울 서초구',$4,false,$5::jsonb) val
`, [UID, cardId, ownerId, province, {
  applicant_display_nickname: "Local QA",
  age: 25,
  height_cm: 175,
  region: "서울",
  job: "QA",
  training_years: 2,
  intro_text: "Local fixture only",
  instagram_id: "local_fixture",
  photo_paths: ["sample1", "sample2"],
  ...changes,
}]).then((r) => r.rows[0].val);
const get = (db, query, args) => db.query(query, args).then((result) => result.rows[0]?.val);
const status = (db, userId = UID) => get(db, "select public.dating_love_pass_status($1) val", [userId]);

module.exports = { setup };

if (require.main === module) test("love pass rollout and transactions on isolated PostgreSQL", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(setup);
    await db.query("insert into auth.users(id) values($1),($2),($3)", [UID, PEER, OTHER]);
    await db.query("insert into public.profiles values($1,true,false),($2,true,false),($3,false,false)", [UID, PEER, OTHER]);
    await db.query("insert into public.dating_cards(id,owner_user_id,sex) values($1,$4,'male'),($2,$5,'female'),($3,$5,'female'),($6,$5,'female')",
      [MY_CARD, PEER_CARD, PEER_CARD_2, UID, PEER, PEER_CARD_3]);
    await db.exec(sql);
    await db.exec(sql);

    await t.test("default disabled, preexisting SKU still valid; client cannot forge new SKU or access grant functions", async () => {
      assert.equal(await get(db, "select public.dating_love_pass_ready() val"), false);
      assert.deepEqual(await get(db, "select public.reserve_dating_love_pass_order($1,$2) val", [UID, ORDER]), { code: "DISABLED" });
      await db.exec("set role authenticated");
      try {
        await db.query("insert into public.toss_test_payment_orders(user_id,product_type,toss_order_id,order_name,amount) values($1,'custom_installed_product','prior-id','prior',10)", [UID]);
        await assert.rejects(
          db.query("insert into public.toss_test_payment_orders(user_id,product_type,toss_order_id,order_name,amount) values($1,'dating_love_pass_30d','browser-forgery','no',30000)", [UID]),
          (error) => error.code === "42501",
        );
        await assert.rejects(db.query("select public.activate_dating_love_pass('browser-forgery')"), (error) => error.code === "42501");
        await assert.rejects(db.query("select * from public.dating_love_passes"), (error) => error.code === "42501");
      } finally { await db.exec("reset role"); }
      await db.exec("insert into public.site_settings values('dating_love_pass_sale','{\"enabled\":true}')");
      assert.equal(await get(db, "select public.dating_love_pass_ready() val"), false, "partial schema cannot accept charges");
      await db.exec(`
        create function public.get_dating_love_pass_swipe_status(uuid) returns boolean language sql as 'select false';
        create function public.record_dating_love_pass_swipe(uuid,uuid,uuid,uuid,text,text) returns boolean language sql as 'select false';
        create function public.get_dating_love_pass_swipe_users(uuid[]) returns boolean language sql as 'select false';
      `);
      assert.equal(await get(db, "select public.dating_love_pass_ready() val"), true);
    });

    let passId;
    await t.test("reserve is fixed-price, verified/latest card required, retry reuses one order", async () => {
      assert.deepEqual(await get(db, "select public.reserve_dating_love_pass_order($1,$2) val", [OTHER, "other_test_order"]), { code: "INELIGIBLE" });
      assert.deepEqual(await get(db, "select public.reserve_dating_love_pass_order($1,$2) val", [UID, ORDER]), { code: "READY", toss_order_id: ORDER, reused: false });
      assert.deepEqual(await get(db, "select public.reserve_dating_love_pass_order($1,$2) val", [UID, "retry_test_order"]), { code: "READY", toss_order_id: ORDER, reused: true });
      assert.equal(await get(db, "select amount val from public.toss_test_payment_orders where toss_order_id=$1", [ORDER]), 30000);
      const spare = "test_second_lovepass";
      assert.equal((await get(db, "select public.reserve_dating_love_pass_order($1,$2) val", [PEER, spare])).code, "READY");
      const terminalSql = "select public.close_dating_love_pass_order($1,$2,$3::jsonb) val";
      const expired = receipt({ orderId: spare, status: "EXPIRED" });
      assert.equal(await get(db, terminalSql, [UID, spare, expired]), false, "wrong owner cannot close");
      assert.equal(await get(db, terminalSql, [PEER, spare, { ...expired, status: "IN_PROGRESS" }]), false, "in-progress receipt cannot close");
      assert.equal(await get(db, terminalSql, [PEER, spare, expired]), true);
      assert.equal((await get(db, "select public.reserve_dating_love_pass_order($1,$2) val", [PEER, "test_second_lovepass_retry"])).reused, false);
    });

    await t.test("verified receipt is required and paid + credit grant are atomic/recoverable with sales disabled", async () => {
      await assert.rejects(finish(db, receipt({ totalAmount: 1 })), /INVALID_LOVE_PASS_RECEIPT/);
      await assert.rejects(finish(db, receipt({ status: "IN_PROGRESS" })), /INVALID_LOVE_PASS_RECEIPT/);
      await assert.rejects(finish(db, receipt({ orderId: "mismatched_provider_order" })), /INVALID_LOVE_PASS_RECEIPT/);
      assert.equal(await get(db, "select status val from public.toss_test_payment_orders where toss_order_id=$1", [ORDER]), "ready");
      assert.equal(await status(db), null);
      await db.exec("update public.site_settings set value_json='{\"enabled\":false}' where key='dating_love_pass_sale'");
      passId = await finish(db);
      assert.equal(await finish(db), passId);
      assert.equal(await get(db, "select public.activate_dating_love_pass($1) val", [ORDER]), passId);
      const state = await status(db);
      assert.equal(state.id, passId);
      assert.equal(state.creditsRemaining, 40);
      assert.equal(state.publicationsRemaining, 4);
      assert.equal(Date.parse(state.expiresAt)-Date.parse(state.startsAt), 30*24*60*60*1000);
      assert.equal(await status(db, OTHER), null);
      assert.equal(await get(db, "select count(*)::int val from public.dating_love_passes"), 1);
      assert.equal(await get(db, "select status val from public.toss_test_payment_orders where toss_order_id=$1", [ORDER]), "paid");
    });

    await t.test("area and moderation checks are bounded and immediate publication is atomic/owned", async () => {
      await assert.rejects(db.query("select public.set_dating_love_pass_areas($1,array['서울','울산','인천'])", [UID]), (e) => e.code === "23514");
      await assert.rejects(db.query("select public.set_dating_love_pass_areas($1,array['서울','서울'])", [UID]), (e) => e.code === "23514");
      await assert.rejects(db.query("select public.set_dating_love_pass_areas($1,array['미등록 지역'])", [UID]), (e) => e.code === "23514");
      assert.deepEqual((await get(db, "select public.set_dating_love_pass_areas($1,array['서울','울산']) val", [UID])).areas, ["서울","울산"]);
      assert.deepEqual((await status(db)).areas, ["서울", "울산"]);
      await assert.rejects(db.query("select public.publish_dating_love_pass_card($1,$2)", [UID, PEER_CARD]), /CARD_NOT_AVAILABLE/);
      await assert.rejects(db.query("select public.publish_dating_love_pass_card($1,$2)", [UID, MY_CARD]), /CARD_REVIEW_REQUIRED/);
      await db.query(`
        insert into public.dating_profile_review_jobs
        select c.id,'open_card',c.owner_user_id,public.dating_profile_review_payload('open_card',to_jsonb(c)),'complete','open','{"suspicionLevel":"clear"}'
        from public.dating_cards c where c.id=any($1::uuid[])
      `, [[MY_CARD, PEER_CARD, PEER_CARD_2]]);
      assert.deepEqual(await get(db, "select public.get_dating_love_pass_reviewable_cards($1) val", [[MY_CARD, PEER_CARD_3, MY_CARD]]), [MY_CARD]);
      assert.equal(await get(db, "select public.get_dating_love_pass_card_photo_snapshot($1) val", [PEER_CARD_3]), null);
      assert.deepEqual((await get(db, "select public.get_dating_love_pass_card_photo_snapshot($1) val", [PEER_CARD])).photo_paths, []);
      await db.query("update public.dating_cards set photo_paths=$2::jsonb where id=$1", [PEER_CARD, ["updated_unreviewed"]]);
      assert.equal(await get(db, "select public.get_dating_love_pass_card_photo_snapshot($1) val", [PEER_CARD]), null, "changed photos require a review of the new fingerprint");
      await db.query("update public.dating_cards set photo_paths='[]' where id=$1", [PEER_CARD]);
      const publication = await get(db, "select public.publish_dating_love_pass_card($1,$2) val", [UID, MY_CARD]);
      assert.equal(publication.cardId, MY_CARD);
      assert.equal(Date.parse(publication.expiresAt)-Date.parse(publication.publishedAt), 24*60*60*1000);
      assert.deepEqual(await get(db, "select public.publish_dating_love_pass_card($1,$2) val", [UID, MY_CARD]), publication);
      assert.equal((await status(db)).publicationsRemaining, 3);
      await db.query("update public.dating_cards set status='pending',published_at=null,expires_at=null where id=$1", [MY_CARD]);
      assert.equal(await get(db, "select love_pass_publication_id val from public.dating_cards where id=$1", [MY_CARD]), null);
      await assert.rejects(db.query("select public.publish_dating_love_pass_card($1,$2)", [UID, MY_CARD]), /PASS_PUBLISH_COOLDOWN/);
      assert.equal((await status(db)).publicationsRemaining, 3);
      await db.query("update public.dating_love_passes set expires_at=now()+interval '1 day' where id=$1", [passId]);
      const nearExpiry = await status(db);
      assert.ok(Date.parse(nearExpiry.nextPublicationAt)>Date.parse(nearExpiry.expiresAt), "UI must not infer availability from a missing date when another publication won't fit");
    });

    await t.test("apply spends free first then expiring pass credits, guards pending cards, card payload and duplicate", async () => {
      await db.query("insert into public.user_apply_credits values($1,9,now())", [UID]);
      assert.deepEqual(await take(db, PEER_CARD, PEER, "부산"), { code: "FORBIDDEN" });
      assert.deepEqual(await take(db, PEER_CARD_3, PEER, "서울"), { code: "FORBIDDEN" });
      const free = await take(db, PEER_CARD, PEER, "서울", { applicant_user_id: OTHER, status: "accepted" });
      assert.equal(free.code, "APPLIED");
      assert.equal(free.used, "base");
      assert.equal(free.pass_credits_remaining, 40);
      assert.equal(await get(db, "select applicant_user_id val from public.dating_card_applications where id=$1", [free.application_id]), UID);
      assert.equal(await get(db, "select status val from public.dating_card_applications where id=$1", [free.application_id]), "submitted");
      await db.query("update public.user_daily_apply_usage set base_used=2 where user_id=$1", [UID]);
      await assert.rejects(take(db, PEER_CARD_2, PEER, "서울", { photo_paths: [] }), (e) => e.code === "23514");
      assert.equal((await status(db)).creditsRemaining, 40, "constraint failure rolls back debit");
      const extra = await take(db, PEER_CARD_2, PEER, "서울");
      assert.equal(extra.used, "pass");
      assert.equal(extra.pass_credits_remaining, 39);
      assert.equal(extra.credits_remaining, 9, "permanent credits unchanged");
      const dup = await take(db, PEER_CARD_2, PEER, "서울");
      assert.equal(dup.code, "DUPLICATE");
      assert.equal((await status(db)).creditsRemaining, 39);
      assert.equal(await get(db, "select count(*)::int val from public.dating_love_pass_application_usage"), 1);
    });

    await t.test("cancellation and expiry fail closed without using another user's benefits", async () => {
      await db.query("update public.toss_test_payment_orders set status='canceled' where toss_order_id=$1", [ORDER]);
      assert.equal(await status(db), null);
      await assert.rejects(finish(db), /INVALID_LOVE_PASS_ORDER/);
      assert.deepEqual(await take(db, PEER_CARD_2, PEER, "서울"), { code: "NO_PASS" });
      await db.query("update public.toss_test_payment_orders set status='paid' where toss_order_id=$1", [ORDER]);
      await db.query("update public.dating_love_passes set starts_at=now()-interval '721 hours',expires_at=now()-interval '1 hour' where id=$1", [passId]);
      assert.equal(await status(db), null);
      assert.deepEqual(await take(db, PEER_CARD_2, PEER, "서울"), { code: "NO_PASS" });
    });
  } finally {
    await db.close();
  }
});
