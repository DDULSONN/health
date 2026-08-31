/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node test harness for the actual TS/TSX implementation. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const root = path.resolve(__dirname, "..");
const nowMs = Date.parse("2026-08-31T12:00:00Z");
const routeSource = fs.readFileSync(path.join(root, "app/api/admin/payments/overview/route.ts"), "utf8");
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function loadApi(orders = [], { userId = "admin-test", queryError = false } = {}) {
  const calls = [];
  const db = {
    from(table) {
      const query = { table, filters: [], orders: [], from: 0, to: 999, options: {} };
      const builder = {
        select(fields, options = {}) { query.fields = fields; query.options = options; return builder; },
        eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
        in(key, value) { query.filters.push(["in", key, value]); return builder; },
        gte(key, value) { query.filters.push(["gte", key, value]); return builder; },
        order(key, options) { query.orders.push([key, options.ascending]); return builder; },
        range(from, to) { query.from = from; query.to = to; return builder; },
        limit(limit) { query.to = limit - 1; return builder; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            calls.push(query);
            if (queryError) return { data: null, error: { code: "XX000", message: "Test query failure" } };
            let rows = table === "toss_test_payment_orders" ? [...orders] : [];
            for (const [operation, key, value] of query.filters) {
              rows = rows.filter((row) => operation === "eq" ? row[key] === value : operation === "in" ? value.includes(row[key]) : row[key] != null && row[key] >= value);
            }
            rows.sort((a, b) => {
              for (const [key, ascending] of query.orders) {
                if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1);
              }
              return 0;
            });
            const count = rows.length;
            return { data: query.options.head ? null : rows.slice(query.from, query.to + 1), error: null, count };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const loadedModule = { exports: {} };
  const resolve = (name) => {
    if (name === "@/lib/admin") return { isAdminEmail: () => false };
    if (name === "@/lib/supabase/server") return {
      createAdminClient: () => db,
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) } }),
    };
    return require(name);
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  const script = transpile(routeSource) + "\nexports.__test = {buildTodaySummary,buildPeriodSummary};";
  new Function("require", "module", "exports", "process", "Date", script)(
    resolve, loadedModule, loadedModule.exports, { env: { ADMIN_USER_IDS: "admin-test" } }, FixedDate
  );
  return { ...loadedModule.exports, calls };
}

const order = (id, overrides = {}) => ({
  id, user_id: `user-${id}`, product_type: "one_on_one_contact_exchange", product_meta: null,
  toss_order_id: `order-${id}`, order_name: "1:1 번호교환", amount: 20000, status: "paid", payment_key: "test-key",
  approved_at: "2026-08-31T01:00:00Z", created_at: "2026-08-31T00:00:00Z", raw_response: null, ...overrides,
});
const { buildTodaySummary } = loadApi().__test;

test("today starts at Korean midnight, not UTC midnight or rolling 24 hours", () => {
  const result = buildTodaySummary([
    order("before", { approved_at: "2026-08-30T14:59:59.999Z" }),
    order("at", { approved_at: "2026-08-30T15:00:00.000Z" }),
    order("after", { approved_at: "2026-08-30T16:00:00.000Z" }),
  ], nowMs);
  assert.equal(result.date, "2026-08-31");
  assert.equal(result.startAt, "2026-08-30T15:00:00.000Z");
  assert.equal(result.paidCount, 2);
  assert.equal(result.revenueKrw, 40000);
});
test("created earlier but approved today counts; created today but approved yesterday does not", () => {
  const result = buildTodaySummary([
    order("old", { created_at: "2026-01-01T00:00:00Z" }),
    order("yesterday", { approved_at: "2026-08-30T01:00:00Z" }),
  ], nowMs);
  assert.equal(result.paidCount, 1);
  assert.equal(result.revenueKrw, 20000);
});
test("pending, failed and canceled orders are excluded; partial refunds reduce the amount", () => {
  const result = buildTodaySummary([
    order("ready", { status: "ready", approved_at: null, payment_key: null }),
    order("failed", { status: "failed" }),
    order("canceled", { status: "canceled" }),
    order("partial", { raw_response: { admin_refund: { canceledTotal: 5000 } } }),
  ], nowMs);
  assert.equal(result.paidCount, 1);
  assert.equal(result.revenueKrw, 15000);
});
test("legacy paid orders without approval timestamps retain the existing fallback", () => {
  const result = buildTodaySummary([order("legacy", { approved_at: null, payment_key: null })], nowMs);
  assert.equal(result.paidCount, 1);
  assert.equal(result.revenueKrw, 20000);
});
test("empty day is zero and future payments do not count", () => {
  assert.equal(buildTodaySummary([], nowMs).revenueKrw, 0);
  const result = buildTodaySummary([order("future", { approved_at: "2026-08-31T13:00:00Z" })], nowMs);
  assert.equal(result.paidCount, 0);
});
test("Korean midnight rolls over cleanly across month/year boundaries", () => {
  const midnight = Date.parse("2026-12-31T15:00:00Z");
  const result = buildTodaySummary([order("old", { approved_at: "2026-12-31T14:59:59Z" })], midnight);
  assert.equal(result.date, "2027-01-01");
  assert.equal(result.startAt, "2026-12-31T15:00:00.000Z");
  assert.equal(result.paidCount, 0);
});
test("API gives the same today totals for 7, 30 and 90 days without a new query", async () => {
  const rows = [order("today-old-order", { created_at: "2026-01-01T00:00:00Z" }), order("today"),
    order("yesterday", { approved_at: "2026-08-30T01:00:00Z" })];
  for (const days of [7, 30, 90]) {
    const api = loadApi(rows);
    const response = await api.GET(new Request(`http://localhost/api/admin/payments/overview?days=${days}`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.period.days, days);
    assert.equal(body.today.paidCount, 2);
    assert.equal(body.today.revenueKrw, 40000);
    assert.equal(api.calls.filter((query) => query.table === "toss_test_payment_orders").length, 3);
  }
});
test("today totals use the full ledger, not just 30 recently displayed orders", async () => {
  const api = loadApi(Array.from({ length: 65 }, (_, i) => order(String(i))));
  const body = await (await api.GET(new Request("http://localhost/api/admin/payments/overview"))).json();
  assert.equal(body.orders.length, 30);
  assert.equal(body.today.paidCount, 65);
  assert.equal(body.today.revenueKrw, 1300000);
});
test("admin-only access is retained and errors never masquerade as zero revenue", async () => {
  for (const [userId, expected] of [[null, 401], ["regular-user", 403]]) {
    const api = loadApi([], { userId });
    const response = await api.GET(new Request("http://localhost/api/admin/payments/overview"));
    assert.equal(response.status, expected);
    assert.equal(api.calls.length, 0);
  }
  const api = loadApi([], { queryError: true });
  const response = await api.GET(new Request("http://localhost/api/admin/payments/overview"));
  assert.equal(response.status, 500);
  assert.equal(Object.hasOwn(await response.json(), "today"), false);
});
test("summary renders Korean amount/count, explicit basis, zero and legacy response safely", () => {
  const source = fs.readFileSync(path.join(root, "components/admin/AdminTodayPaymentSummary.tsx"), "utf8");
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", transpile(source))(require, loadedModule, loadedModule.exports);
  const Summary = loadedModule.exports.default;
  const data = { date: "2026-08-31", startAt: "2026-08-30T15:00:00Z", endAt: "2026-08-31T12:12:00Z", revenueKrw: 309900, paidCount: 20 };
  const html = renderToStaticMarkup(React.createElement(Summary, { data }));
  for (const text of ["오늘 결제 금액", "309,900원", "20건", "2026-08-31", "00:00~21:12", "취소·환불 제외"]) assert.ok(html.includes(text), text);
  assert.ok(renderToStaticMarkup(React.createElement(Summary, { data: { ...data, revenueKrw: 0, paidCount: 0 } })).includes("0원"));
  assert.equal(renderToStaticMarkup(React.createElement(Summary, { data: null })), "");
});
