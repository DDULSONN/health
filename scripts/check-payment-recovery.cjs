/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file, mocks = {}, globals = {}) {
  const code = ts.transpileModule(source(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)((id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (id.startsWith("@/")) throw new Error("Unexpected dependency: " + id);
    return require(id);
  }, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const applyReturn = load("lib/dating-apply-return.ts");
const cardNotice = load("lib/payment-card-notice.ts");
const guidance = load("lib/payment-guidance.ts", { "@/lib/dating-apply-return": applyReturn, "@/lib/payment-card-notice": cardNotice });
const notice = load("components/PaymentCardNotice.tsx", { "@/lib/payment-card-notice": cardNotice }).default;
const applyPath = "/community/dating/cards/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/apply?from=nearby";
const orderId = "a".repeat(32);

test("card warning renders readable Korean without a new button or payment action", () => {
  const html = renderToStaticMarkup(React.createElement(notice));
  assert.ok(html.includes("현대·KB국민·우리카드"));
  assert.ok(html.includes("다른 카드사의 카드를 이용해 주세요."));
  assert.ok(!html.includes("�"));
  assert.ok(!/<button|<a\b|<form/.test(html));
});

test("failure notice is emphasized without changing the compact checkout notice", () => {
  const compact = renderToStaticMarkup(React.createElement(notice));
  const prominent = renderToStaticMarkup(React.createElement(notice, { prominent: true }));
  assert.ok(compact.includes("text-xs"));
  assert.ok(prominent.includes("text-sm font-medium"));
  assert.ok(!prominent.includes("text-xs"));
  assert.ok(prominent.includes(guidance.PAYMENT_CARD_NOTICE));
});

test("credit retry preserves the original application return path", () => {
  const action = guidance.getPaymentRecoveryAction("apply_credits", { returnTo: applyPath });
  const url = new URL(action.href, "https://helchang.com");
  assert.equal(url.pathname, "/dating/apply-credits");
  assert.equal(url.searchParams.get("returnTo"), applyPath);
  assert.ok(source("app/dating/apply-credits/page.tsx").includes('returnTo: normalizeDatingApplyReturn(new URLSearchParams(window.location.search).get("returnTo"))'));
});

test("invalid application returns cannot redirect offsite or to arbitrary local APIs", () => {
  for (const returnTo of ["//evil.test", "https://evil.test", "/api/admin/x", applyPath + "&next=//evil", "javascript:alert(1)", "\\evil.test"]) {
    assert.equal(guidance.getPaymentRecoveryAction("apply_credits", { returnTo }).href, "/dating/apply-credits");
  }
});

test("nearby retry preserves Korean region without allowing URL injection", () => {
  for (const province of ["경기", "서울", "서울&next=//evil.test#x"]) {
    const url = new URL(guidance.getPaymentRecoveryAction("city_view", { province }).href, "https://helchang.com");
    assert.equal(url.origin, "https://helchang.com");
    assert.equal(url.pathname, "/dating/nearby-view");
    assert.equal(url.searchParams.get("province"), province);
    assert.equal(url.searchParams.size, 1);
  }
});

test("contact exchange returns to the 1:1 matching tab; drafts and subscriptions use existing recovery", () => {
  assert.equal(guidance.getPaymentRecoveryAction("one_on_one_contact_exchange").href, "/mypage?section=matching&match=one_on_one");
  for (const product of ["paid_card", "one_on_one_plus_7d", "one_on_one_plus_30d", "swipe_premium_30d", "dating_all_pass_30d", "unknown", null]) {
    assert.equal(guidance.getPaymentRecoveryAction(product).href, "/mypage?section=payment");
  }
});

test("identifiers and provider codes reject arbitrary text and personal information", () => {
  assert.equal(guidance.normalizeFailureOrderId(orderId), orderId);
  for (const value of [null, "-", "a".repeat(65), "x@y.test", {}, "/order/abc"]) assert.equal(guidance.normalizeFailureOrderId(value), null);
  for (const value of [null, "현대 카드 오류", "user@example.com", "bad\nCODE", "1", "A".repeat(81)]) assert.equal(guidance.normalizePaymentFailureCode(value), "UNKNOWN");
  assert.equal(guidance.normalizePaymentFailureCode("PAY_PROCESS_CANCELED"), "PAY_PROCESS_CANCELED");
});

function renderFailure(params) {
  const page = load("app/payments/fail/page.tsx", {
    "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
    "next/navigation": { useSearchParams: () => new URLSearchParams(params) },
    "@/lib/dating-apply-return": applyReturn,
    "@/lib/payment-guidance": guidance,
    "@/components/PaymentCardNotice": { default: notice },
    "@/lib/payment-failure-client": { reportPaymentFailure: () => { throw new Error("No effects during SSR"); } },
    "@/components/dating/ContactPaymentRecovery": { default: () => React.createElement("div", null, "주문과 결제 상태를 확인하고 있어요.") },
  });
  return renderToStaticMarkup(React.createElement(page.default));
}

test("failure UI is escaped, contains recovery and does not claim all errors are card restrictions", () => {
  const html = renderFailure({ productType: "city_view", province: "경기", code: "REJECT_CARD_COMPANY", message: "<script>alert(1)</script>" });
  assert.ok(html.includes("결제가 완료되지 않았어요"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("승인 문자를 받았다면"));
  assert.ok(html.includes("<details"));
  assert.ok(!html.includes("�"));
});

test("customer cancellation has a separate heading; old callbacks without order IDs still render", () => {
  const html = renderFailure({ code: "PAY_PROCESS_CANCELED", productType: "apply_credits", returnTo: applyPath });
  assert.ok(html.includes("결제를 중단했어요"));
  assert.ok(html.includes("작성하던 지원서로 돌아가기"));
  assert.ok(html.includes("확인되지 않음"));
  assert.ok(renderFailure({}).includes("결제센터에서 이어하기"));
});

test("every product failure shows the same issuer restriction without hiding the provider error", () => {
  for (const productType of ["apply_credits", "paid_card", "city_view", "more_view", "one_on_one_contact_exchange", "one_on_one_plus_7d", "one_on_one_plus_30d", "dating_all_pass_30d", "love_fortune_detail", "unknown"]) {
    const html = renderFailure({ productType, code: "REJECT_CARD_COMPANY", message: "카드사에서 승인을 거절했습니다." });
    assert.ok(html.includes(guidance.PAYMENT_CARD_NOTICE), productType);
    assert.ok(html.includes("카드사에서 승인을 거절했습니다."), productType);
    assert.ok(html.includes("승인 문자를 받았다면"), productType);
    assert.ok(!html.includes("�"), productType);
  }
});

test("legacy failure route shares the issuer notice and distinguishes customer cancellation", () => {
  for (const code of ["REJECT_CARD_COMPANY", "PAY_PROCESS_CANCELED", "UNKNOWN"]) {
    const page = load("app/payments/test/fail/page.tsx", {
      "next/link": { default: ({ children, ...props }) => React.createElement("a", props, children) },
      "next/navigation": { useSearchParams: () => new URLSearchParams({ code, message: "<script>bad</script>" }) },
      "@/components/PaymentCardNotice": { default: notice },
    });
    const html = renderToStaticMarkup(React.createElement(page.default));
    assert.ok(html.includes(guidance.PAYMENT_CARD_NOTICE));
    assert.ok(html.includes(code === "PAY_PROCESS_CANCELED" ? "결제를 중단했어요" : "결제 진행 실패"));
    assert.ok(html.includes('href="/payments/test"'));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>"));
  }
});

function api({ user = "user-1", owner = "user-1", originBlocked = false, orderError = false, insertError = false, oldOrder = false, status = "ready" } = {}) {
  const queries = [], writes = [];
  const db = { from(table) {
    const filters = [];
    const builder = {
      select(fields) { queries.push({ table, fields, filters }); return builder; },
      eq(key, value) { filters.push([key, value]); return builder; },
      gte(key, value) { filters.push([key, value]); return builder; },
      async maybeSingle() {
        assert.equal(table, "toss_test_payment_orders");
        assert.ok(filters.some(([key, value]) => key === "user_id" && value === user));
        assert.ok(filters.some(([key]) => key === "created_at"));
        return { data: owner === user && !oldOrder ? { id: "order-uuid", product_type: "paid_card", status } : null, error: orderError ? { code: "XX000" } : null };
      },
      async upsert(row, options) {
        assert.equal(table, "payment_checkout_failures", "Order ledger writes are forbidden");
        writes.push({ row, options });
        return { error: insertError ? { code: "42P01" } : null };
      },
    };
    return builder;
  } };
  const route = load("app/api/payments/toss/failure/route.ts", {
    "@/lib/payment-guidance": guidance,
    "@/lib/request-origin": { ensureAllowedMutationOrigin: () => originBlocked ? new Response(null, { status: 403 }) : null },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: user ? { id: user } : null }) },
    "@/lib/supabase/server": { createAdminClient: () => db },
  }, { console: { warn() {} } });
  return { ...route, queries, writes };
}
const request = (body = { orderId, code: "PAY_PROCESS_ABORTED" }) => new Request("https://helchang.com/api/payments/toss/failure", { method: "POST", body: JSON.stringify(body) });

test("unauthenticated, cross-origin and other-user reports cannot write or reveal an order", async () => {
  for (const options of [{ user: null }, { originBlocked: true }, { owner: "another-user" }, { oldOrder: true }, { orderError: true }]) {
    const route = api(options);
    const result = await route.POST(request());
    assert.equal(result.status, options.originBlocked ? 403 : 204);
    assert.equal(await result.text(), "");
    assert.equal(route.writes.length, 0);
  }
});

test("invalid and oversized reports do not hit the database", async () => {
  for (const body of [null, {}, { orderId: "bad" }, { orderId, code: "A".repeat(600) }]) {
    const route = api();
    assert.equal((await route.POST(request(body))).status, 400);
    assert.equal(route.queries.length, 0);
  }
});

test("callback diagnostics use server-owned product and do not store raw errors or user-supplied ownership", async () => {
  const route = api();
  await route.POST(request({ orderId, code: "REJECT_CARD_COMPANY", productType: "hacked", userId: "other", message: "private@example.com", paymentKey: "do-not-store" }));
  assert.deepEqual(route.writes[0], { row: {
    order_id: "order-uuid", user_id: "user-1", product_type: "paid_card", provider_code: "REJECT_CARD_COMPANY", outcome: "failed", source: "client_redirect",
  }, options: { onConflict: "order_id", ignoreDuplicates: true } });
});

test("user cancellation is not counted as card failure; paid orders are never overwritten by a callback", async () => {
  for (const status of ["ready", "paid", "canceled"]) {
    const route = api({ status });
    await route.POST(request({ orderId, code: "PAY_PROCESS_CANCELED" }));
    assert.equal(route.writes[0].row.outcome, "user_canceled");
    assert.equal(route.writes[0].row.source, "client_redirect");
    assert.equal(route.writes.length, 1);
  }
});

test("missing diagnostic table does not break recovery", async () => {
  const route = api({ insertError: true });
  assert.equal((await route.POST(request())).status, 204);
});

function client({ storageBroken = false, networkBroken = false } = {}) {
  const calls = [], values = new Map();
  const reporter = load("lib/payment-failure-client.ts", { "@/lib/payment-guidance": guidance }, {
    window: { sessionStorage: {
      getItem(key) { if (storageBroken) throw new Error("blocked"); return values.get(key); },
      setItem(key, value) { if (storageBroken) throw new Error("blocked"); values.set(key, value); },
    } },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (networkBroken) throw new Error("offline");
      return new Response(null, { status: 204 });
    },
  });
  return { ...reporter, calls };
}

test("client suppresses StrictMode concurrent calls and refresh duplicates", async () => {
  const reporter = client();
  await Promise.all([reporter.reportPaymentFailure(orderId, "X"), reporter.reportPaymentFailure(orderId, "X")]);
  await reporter.reportPaymentFailure(orderId, "X");
  assert.equal(reporter.calls.length, 1);
  assert.equal(reporter.calls[0].init.keepalive, true);
  assert.equal(reporter.calls[0].init.credentials, "same-origin");
});

test("storage and network failures never reject the recovery UI; missing order IDs make no request", async () => {
  for (const options of [{ storageBroken: true }, { networkBroken: true }]) {
    const reporter = client(options);
    await assert.doesNotReject(() => reporter.reportPaymentFailure(orderId, "X"));
  }
  const reporter = client();
  await reporter.reportPaymentFailure(null, "X");
  assert.equal(reporter.calls.length, 0);
});

test("payment creation preserves the failure order ID without modifying success URL behavior", () => {
  const code = source("app/api/payments/toss/create/route.ts");
  assert.ok(code.includes('failUrl.searchParams.set("failedOrderId", tossOrderId)'));
  assert.ok(!code.includes('successUrl.searchParams.set("failedOrderId"'));
  assert.ok(!source("app/payments/fail/page.tsx").includes("/api/payments/toss/create"));
});

test("both contact checkout surfaces use the shared offer; free exchanges remain exempt", () => {
  for (const file of ["app/mypage/page.tsx", "app/community/dating/cards/page.tsx"]) {
    assert.ok(source(file).includes("<OneOnOneContactOffer"), file);
  }
  assert.ok(source("app/mypage/page.tsx").includes("included={plusContactExchangeIncluded}"));
  assert.ok(source("components/dating/OneOnOneContactOffer.tsx").includes("!included && <PaymentCardNotice"));
});

test("PostgreSQL migration is idempotent, private, deduplicated and leaves payment state alone", { skip: !process.env.PAYMENT_RECOVERY_PGLITE_PATH }, async () => {
  const { PGlite } = require(process.env.PAYMENT_RECOVERY_PGLITE_PATH);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.toss_test_payment_orders(id uuid primary key, status text);
      insert into auth.users values ('00000000-0000-0000-0000-000000000001');
      insert into public.toss_test_payment_orders values ('00000000-0000-0000-0000-000000000002','paid');`);
    await db.exec(source("supabase/sql/payment_checkout_failures.sql"));
    await db.exec(source("supabase/sql/payment_checkout_failures.sql"));
    const flags = (await db.query(`select relrowsecurity as rls from pg_class where oid='public.payment_checkout_failures'::regclass`)).rows[0];
    assert.equal(flags.rls, true);
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["select", "insert", "update", "delete"]) {
        assert.equal((await db.query(`select has_table_privilege($1,'public.payment_checkout_failures',$2) as allowed`, [role, privilege])).rows[0].allowed, false);
      }
    }
    await db.exec("set role service_role");
    const sql = `insert into public.payment_checkout_failures (order_id,user_id,product_type,provider_code,outcome)
      values ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','paid_card','PAY_PROCESS_ABORTED','failed') on conflict(order_id) do nothing`;
    await db.exec(sql); await db.exec(sql);
    assert.equal((await db.query("select count(*)::int as n from public.payment_checkout_failures")).rows[0].n, 1);
    await db.exec("reset role");
    assert.equal((await db.query("select status from public.toss_test_payment_orders")).rows[0].status, "paid");
    await db.exec("delete from public.toss_test_payment_orders");
    assert.equal((await db.query("select count(*)::int as n from public.payment_checkout_failures")).rows[0].n, 0);
  } finally { await db.close(); }
});
