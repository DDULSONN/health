/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const src = (file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
function load(file, mocks = {}) {
  const code = ts.transpileModule(src(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    assert.ok(Object.hasOwn(mocks, id), `Unexpected import: ${id}`);
    return mocks[id];
  }, module, module.exports);
  return module.exports;
}

const nav = load("lib/dating-1on1-match-navigation.ts");
const helper = load("lib/contact-payment-order-state.ts", { "@/lib/dating-1on1-match-navigation": nav });
const member = "11111111-1111-1111-1111-111111111111";
const other = "22222222-2222-2222-2222-222222222222";
const stranger = "33333333-3333-3333-3333-333333333333";
const matchId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const oldMatchId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const created = "2026-11-27T00:00:00.000Z";
const order = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  product_ref_id: matchId,
  product_type: "one_on_one_contact_exchange",
  product_meta: { matchId },
  toss_order_id: "fixture_order_123",
  order_name: "1:1 번호 교환",
  amount: 18_000,
  status: "paid",
  approved_at: created,
  created_at: created,
  raw_response: { method: "카드", receipt: { url: "https://example.test/receipt" }, paymentKey: "provider-secret-fixture" },
};
const match = {
  id: matchId, source_user_id: member, candidate_user_id: other, state: "mutual_accepted",
  contact_exchange_status: "approved", contact_exchange_paid_by_user_id: member,
  contact_exchange_note: `toss payment ${order.toss_order_id} | auto-approved`,
  contact_exchange_approved_at: created,
};

test("only paid contact orders resolve a delivery result; inconsistent or invalid references fail closed", () => {
  for (const status of ["ready", "failed", "canceled"]) assert.equal(helper.contactOrderDelivery({ ...order, status }, match, member), null);
  assert.equal(helper.contactOrderDelivery({ ...order, product_type: "apply_credits" }, match, member), null);
  assert.equal(helper.contactOrderMatchId({ ...order, product_meta: { matchId: oldMatchId } }), null);
  assert.equal(helper.contactOrderMatchId({ ...order, product_ref_id: null }), matchId);
  assert.equal(helper.contactOrderMatchId({ ...order, product_ref_id: "bad", product_meta: null }), null);
});

test("exact standard and privacy-choice delivery bound to the same order are complete", () => {
  for (const contact_exchange_note of [match.contact_exchange_note, `instagram:v1:${order.id}`]) {
    assert.deepEqual(helper.contactOrderDelivery(order, { ...match, contact_exchange_note }, member), { status: "delivered", matchId });
  }
});

test("approval and delivery are independent, and a voucher/other order never completes the current order", () => {
  assert.deepEqual(helper.contactOrderDelivery(order, { ...match, contact_exchange_status: "payment_pending_admin", contact_exchange_note: null, contact_exchange_approved_at: null }, member), { status: "processing", matchId: null });
  for (const candidate of [
    undefined,
    { ...match, id: oldMatchId },
    { ...match, state: "canceled" },
    { ...match, contact_exchange_status: "canceled" },
    { ...match, contact_exchange_approved_at: null },
    { ...match, contact_exchange_paid_by_user_id: other },
    { ...match, contact_exchange_note: "contact-care manual voucher test" },
    { ...match, contact_exchange_note: "toss payment fixture_order_123-other | auto-approved" },
    { ...match, contact_exchange_note: "instagram:v1:other-order" },
    { ...match, source_user_id: stranger },
  ]) assert.deepEqual(helper.contactOrderDelivery(order, candidate, member), { status: "check_required", matchId: null });
});

function paymentList({ user = { id: member }, orders = [order], matches = [match], matchError = null } = {}) {
  const queries = [];
  const db = { from(table) {
    const values = {
      toss_test_payment_orders: { data: orders, error: null },
      dating_1on1_match_proposals: { data: matches, error: matchError },
      user_daily_apply_usage: { data: { base_used: 1 }, error: null },
      user_apply_credits: { data: { credits: 3 }, error: null },
    };
    const step = { table, operations: [] };
    queries.push(step);
    const builder = { then: (resolve, reject) => Promise.resolve(values[table]).then(resolve, reject) };
    for (const op of ["select", "eq", "in", "or", "order", "limit", "maybeSingle"]) {
      builder[op] = (...args) => { step.operations.push([op, ...args]); return builder; };
    }
    return builder;
  } };
  const route = load("app/api/mypage/payments/route.ts", {
    "@/lib/contact-payment-order-state": helper,
    "@/lib/dating-more-view": { getMoreViewStatusBySex: async () => ({ male: "none", female: "approved" }) },
    "@/lib/dating-apply-limits": { getDailyBaseApplyLimit: () => 5, getKstDateString: () => "2026-11-27", isKoreanWeekend: () => false },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user, client: db }) },
    "@/lib/supabase/server": { createAdminClient: () => db },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  });
  return { queries, run: () => route.GET(new Request("https://example.test/api/mypage/payments")) };
}

test("payment list reads only the authorized own orders, adds one bounded participant query and returns no raw payload", async () => {
  const read = paymentList();
  const res = await read.run();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control"), /no-store/);
  assert.match(res.headers.get("vary"), /Authorization/);
  const queries = read.queries.filter(q => q.table === "dating_1on1_match_proposals" || q.table === "toss_test_payment_orders");
  assert.equal(queries.length, 2);
  assert.ok(queries[0].operations.some(op => op[0] === "eq" && op[1] === "user_id" && op[2] === member));
  assert.deepEqual(queries[1].operations.find(op => op[0] === "in"), ["in", "id", [matchId]]);
  assert.ok(queries[1].operations.some(op => op[0] === "or" && op[1] === `source_user_id.eq.${member},candidate_user_id.eq.${member}`));
  const result = await res.json();
  assert.equal(result.orders[0].contactDelivery, "delivered");
  assert.equal(result.orders[0].contactDeliveryMatchId, matchId);
  assert.equal(result.orders[0].method, "카드");
  assert.equal(result.orders[0].receiptUrl, "https://example.test/receipt");
  assert.ok(!/provider-secret-fixture|contact_exchange_note|source_user_id|raw_response/.test(JSON.stringify(result)));
});

test("a legacy/missing match query preserves the rest of payment history but never falsely completes a contact", async () => {
  const readyCredit = { ...order, id: "credit-1", product_type: "apply_credits", status: "ready" };
  const read = paymentList({ orders: [order, readyCredit], matchError: { code: "fixture" } });
  const res = await read.run();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.orders[0].contactDelivery, "check_required");
  assert.equal(body.orders[0].contactDeliveryMatchId, null);
  assert.equal(body.orders[1].canResumeProduct, true);
  assert.equal(body.orders[1].contactDelivery, undefined);
  assert.equal(body.summary.creditsRemaining, 3);
});

test("unauthenticated payment history does not read any tables", async () => {
  const read = paymentList({ user: null });
  assert.equal((await read.run()).status, 401);
  assert.equal(read.queries.length, 0);
});

test("payment center status mode is owned, private and returns the state only", async () => {
  const seen = [];
  const route = load("app/api/payments/toss/contact-recovery/route.ts", {
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: { id: member } }) },
    "@/lib/supabase/server": { createAdminClient: () => "client" },
    "@/lib/payment-guidance": { normalizeFailureOrderId: x => x === order.toss_order_id ? x : null },
    "@/lib/contact-payment-recovery": { getContactPaymentRecovery: async (...args) => {
      seen.push(args);
      return { view: { state: "pending", matchId, name: "fixture", photoUrl: "private-profile-image" }, checkoutUrl: "not-for-browser-display" };
    } },
  });
  const url = `https://example.test/api/payments/toss/contact-recovery?orderId=${order.toss_order_id}`;
  const res = await route.GET(new Request(url + "&view=order-status"));
  assert.deepEqual(await res.json(), { ok: true, state: "pending" });
  assert.match(res.headers.get("cache-control"), /private, no-store/);
  assert.deepEqual(seen, [["client", member, order.toss_order_id]]);
  const old = await (await route.GET(new Request(url))).json();
  assert.equal(old.recovery.matchId, matchId);
  assert.equal(old.checkoutUrl, undefined);
});

test("my payment center's order-specific check performs no POST or fresh checkout", () => {
  const page = src("app/mypage/page.tsx");
  const payment = page.slice(page.indexOf("완료하지 않은 결제가 있어요."), page.indexOf(">결제 안내</p>"));
  assert.ok(payment.includes("<ContactPaymentOrderCheck"));
  assert.ok(!payment.includes("handleRequestOneOnOneContactExchange"));
  const control = src("components/dating/ContactPaymentOrderCheck.tsx");
  assert.match(control, /contact-recovery\?/);
  assert.match(control, /view: "order-status"/);
  assert.doesNotMatch(control, /POST|\/toss\/create|\/toss\/confirm/);
});
