/* eslint-disable @typescript-eslint/no-require-imports */
// Offline tests: mocked search/auth; optional isolated, in-memory PostgreSQL.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
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
const common = load("lib/public-reactions.ts");
const env = { PUBLIC_REACTIONS_ENABLED: "1", PUBLIC_REACTIONS_OPENAI_API_KEY: "fake-offline-key", CRON_SECRET: "fake-cron-secret" };
const server = (fetch, customEnv = env) => load("lib/public-reactions-server.ts", { "@/lib/public-reactions": common }, { fetch, process: { env: customEnv } });
const url = "https://community.example.com/posts/7";
const item = { url, title: "짐툴 이용 후기 · 테스트", summary: "매칭 화면을 이용한 경험을 정리한 예시입니다.", kind: "reaction", sentiment: "neutral", published_date: "2026-09-10" };
const message = (text) => ({ type: "message", content: [{ type: "output_text", text }] });
const searchResult = { status: "completed", output: [
  { type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url, title: item.title }] } },
  message("공개 검색 결과: 짐툴 테스트 후기. 원문 출처를 확인하세요."),
] };
function fakeSearch(items = [item]) {
  const calls = [];
  const fetch = async (target, options) => {
    assert.equal(target, "https://api.openai.com/v1/responses");
    calls.push(JSON.parse(options.body));
    assert.equal(options.cache, "no-store");
    assert.ok(options.headers["Content-Type"].includes("utf-8"));
    return Response.json(calls.length === 1 ? searchResult : { status: "completed", output: [message(JSON.stringify({ items }))] });
  };
  return { calls, fetch };
}
test("URLs strip tracking and fragments, preserve the post identity", () => {
  assert.equal(common.normalizeReactionUrl(url + "?utm_source=x&id=3#reply"), url + "?id=3");
  assert.equal(common.normalizeReactionUrl("https://www.community.example.com/posts/7/"), url);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://localhost/x", "http://127.0.0.1", "http://2130706433", "http://[::1]", "https://x:pass@x.com", "https://host.local", "https://x.com:123"]) assert.equal(common.normalizeReactionUrl(bad), null);
});
test("own site and automatic reputation checkers cannot count as customer feedback", () => {
  for (const host of ["helchang.com", "www.helchang.com", "scamadviser.com", "robtex.com"]) assert.equal(common.isExcludedReactionSource("https://" + host + "/x"), true);
});
test("source allowlist, canonical dedup and Korean output", () => {
  const result = common.validateReactionItems([item, { ...item, url: url + "?utm_source=x" }, { ...item, url: "https://invented.example.com" }], new Set([url]));
  assert.equal(result.items.length, 1); assert.equal(result.excluded, 2); assert.equal(result.items[0].title, item.title);
});
test("invalid or all-fabricated items fail instead of becoming a zero report", () => {
  assert.throws(() => common.validateReactionItems([item], new Set()), /INVALID_RESULT/);
  assert.throws(() => common.validateReactionItems([{ ...item, summary: "" }], new Set([url])), /INVALID_RESULT/);
  assert.throws(() => common.validateReactionItems(Array(31).fill(item), new Set([url])), /INVALID_RESULT/);
  assert.deepEqual(common.validateReactionItems([], new Set()), { items: [], excluded: 0 });
});
test("unknown and impossible publication dates are not invented; promotional sentiment is not counted", () => {
  const now = new Date("2026-09-14T03:00:00Z");
  for (const date of ["2026-02-31", "2030-01-01", "tomorrow", null]) assert.equal(common.validateReactionItems([{ ...item, published_date: date }], new Set([url]), now).items[0].published_date, null);
  const promo = common.validateReactionItems([{ ...item, kind: "promotion", sentiment: "positive" }], new Set([url]), now).items[0];
  assert.equal(promo.sentiment, "unknown");
  assert.equal(common.validateReactionItems([{ ...item, published_date: "2019-12-29" }], new Set([url]), now).items[0].kind, "uncertain");
});
test("Korean date rolls over at 15:00 UTC; retry only after ten minutes", () => {
  assert.equal(common.koreanDate(new Date("2026-09-14T15:00:00Z")), "2026-09-15");
  const run = { run_date: "2026-09-14", status: "failed", attempt: 1, started_at: "2026-09-14T00:00:00Z" };
  assert.equal(common.canStartReactionScan(run, new Date("2026-09-14T00:09:59Z")), false);
  assert.equal(common.canStartReactionScan(run, new Date("2026-09-14T00:10:00Z")), true);
  assert.equal(common.canStartReactionScan({ ...run, status: "success" }, new Date("2026-09-14T01:00:00Z")), false);
  assert.equal(common.canStartReactionScan({ ...run, attempt: 2 }, new Date("2026-09-14T01:00:00Z")), false);
});
test("cron fails closed without a secret; spoofed scheduler headers are insufficient", () => {
  const target = "https://helchang.com/api/cron/public-reactions";
  for (const headers of [{}, { "x-vercel-cron": "1", "user-agent": "vercel-cron" }, { authorization: "Bearer wrong" }]) assert.equal(server().isReactionCronAuthorized(new Request(target, { headers })), false);
  assert.equal(server().isReactionCronAuthorized(new Request(target, { headers: { authorization: "Bearer fake-cron-secret" } })), true);
  assert.equal(server(undefined, {}).isReactionCronAuthorized(new Request(target)), false);
});
test("configuration absence never acquires a DB lock or makes a paid call", async () => {
  await assert.rejects(() => server(() => assert.fail("network"), {}).runPublicReactionScan({ rpc() { assert.fail("database"); } }), /NOT_CONFIGURED/);
});
test("bounded two-phase search, no retained provider response, cited links only", async () => {
  const fake = fakeSearch();
  const result = await server(fake.fetch).searchPublicReactions(new Date("2026-09-14T00:00:00Z"));
  assert.equal(fake.calls.length, 2); assert.equal(fake.calls[0].max_tool_calls, 3);
  assert.equal(fake.calls[0].tool_choice, "required");
  assert.equal(fake.calls[0].store, false); assert.equal(fake.calls[1].store, false);
  assert.equal(fake.calls[1].tools, undefined); assert.equal(fake.calls[1].text.format.strict, true);
  assert.equal(result.items[0].title, item.title); assert.equal(result.source_count, 1);
  assert.ok(fake.calls[0].input.includes("2026-09-14"));
});
for (const [status, code] of [[401, "PROVIDER_AUTH"], [403, "PROVIDER_AUTH"], [429, "PROVIDER_LIMIT"], [500, "PROVIDER_FAILED"]]) test("upstream " + status + " exposes only controlled errors without automatic retries", async () => {
  let count = 0;
  await assert.rejects(() => server(async () => { count++; return new Response("PRIVATE_KEY_ACCOUNT_DETAILS", { status }); }).searchPublicReactions(), new RegExp(code));
  assert.equal(count, 1);
});
test("no completed search tool or truncated output is rejected", async () => {
  assert.throws(() => server().readSearchEvidence({ output: [message("maybe")] }), /INVALID_RESULT/);
  assert.throws(() => server().readSearchEvidence({ output: [{ type: "web_search_call", status: "failed" }] }), /INVALID_RESULT/);
  await assert.rejects(() => server(async () => Response.json({ status: "incomplete", output: [] })).searchPublicReactions(), /INVALID_RESULT/);
});
function fakeDb({ claim = true, failSave = false } = {}) {
  const writes = [], filters = [];
  const admin = {
    rpc: async (name) => { assert.equal(name, "claim_admin_public_reaction_run"); return { data: claim ? [{ run_date: "2026-09-14", run_token: "token" }] : [], error: null }; },
    from: (table) => {
      assert.equal(table, "admin_public_reaction_runs", "Must not touch member, matching, authentication or payment tables");
      const builder = { update: (values) => { writes.push(values); return builder; }, eq: (key, value) => { filters.push([key, value]); return builder; }, select: () => builder,
        maybeSingle: async () => ({ data: failSave ? null : { run_date: "2026-09-14" }, error: null }),
        then: (done) => Promise.resolve({ error: null }).then(done),
      }; return builder;
    },
  };
  return { admin, writes, filters };
}
test("already claimed day skips every paid call", async () => {
  assert.deepEqual(await server(() => assert.fail("network")).runPublicReactionScan(fakeDb({ claim: false }).admin), { skipped: true });
});
test("success updates only the owned running token", async () => {
  const db = fakeDb();
  await server(fakeSearch().fetch).runPublicReactionScan(db.admin);
  assert.equal(db.writes[0].status, "success");
  assert.deepEqual(db.filters.slice(0, 3), [["run_date", "2026-09-14"], ["run_token", "token"], ["status", "running"]]);
});
test("provider failure preserves earlier results and writes failure, not an empty report", async () => {
  const db = fakeDb();
  await assert.rejects(() => server(async () => new Response("fail", { status: 500 })).runPublicReactionScan(db.admin), /PROVIDER_FAILED/);
  assert.equal(db.writes[0].status, "failed"); assert.equal(db.writes[0].report, undefined);
});
test("lost DB save is never returned as successful", async () => {
  const db = fakeDb({ failSave: true });
  await assert.rejects(() => server(fakeSearch().fetch).runPublicReactionScan(db.admin), /STORAGE_FAILED/);
});
const next = { NextResponse: { json: (body, init) => Response.json(body, init) } };
test("both admin endpoints reject unauthenticated access before any other work", async () => {
  const route = load("app/api/admin/public-reactions/route.ts", {
    "next/server": next, "@/lib/admin-route": { requireAdminRoute: async () => ({ ok: false, response: new Response("no", { status: 401 }) }) },
    "@/lib/admin-audit": {}, "@/lib/public-reactions": common, "@/lib/public-reactions-server": {},
  });
  for (const method of ["GET", "POST"]) assert.equal((await route[method](new Request("https://helchang.com/api/admin/public-reactions"))).status, 401);
});
test("admin POST rejects cross-site and missing origins", async () => {
  const route = load("app/api/admin/public-reactions/route.ts", {
    "next/server": next, "@/lib/admin-route": { requireAdminRoute: async () => ({ ok: true }) },
    "@/lib/admin-audit": {}, "@/lib/public-reactions": common, "@/lib/public-reactions-server": {},
  });
  for (const headers of [{}, { origin: "https://other.example.com" }]) assert.equal((await route.POST(new Request("https://helchang.com/api/admin/public-reactions", { method: "POST", headers }))).status, 403);
});
test("scheduled route rejects unauthenticated cron without constructing a DB client", async () => {
  const route = load("app/api/cron/public-reactions/route.ts", {
    "next/server": next, "@/lib/supabase/server": { createAdminClient() { assert.fail("database"); } },
    "@/lib/public-reactions-server": { isReactionCronAuthorized: () => false },
  });
  assert.equal((await route.GET(new Request("https://helchang.com/api/cron/public-reactions"))).status, 401);
});
test("daily server schedule and admin-only lazy panel integration", () => {
  assert.deepEqual(JSON.parse(source("vercel.json")).crons.filter((row) => row.path === "/api/cron/public-reactions"), [{ path: "/api/cron/public-reactions", schedule: "0 0 * * *" }]);
  const page = source("app/mypage/page.tsx");
  assert.ok(page.includes('dynamic(() => import("@/components/admin/AdminPublicReactionsPanel")'));
  assert.ok(page.includes('adminManageTab === "public_reactions" && <AdminPublicReactionsPanel />'));
});

function ui(customFetch, initial) {
  const React = require("react"), states = [], refs = [], effects = [], calls = [];
  let stateIndex = 0, refIndex = 0;
  const component = load("components/admin/AdminPublicReactionsPanel.tsx", {
    "@/lib/public-reactions": common,
    react: { ...React, useCallback: (fn) => fn, useEffect: (fn) => effects.push(fn),
      useState: (value) => { const i = stateIndex++; if (!(i in states)) states[i] = i === 0 && initial ? initial : value;
        return [states[i], (next) => { states[i] = typeof next === "function" ? next(states[i]) : next; }]; },
      useRef: (value) => refs[refIndex++] ??= { current: value },
    },
  }, { fetch: async (target, options) => {
    assert.ok(target.startsWith("/api/admin/public-reactions")); calls.push({ target, options });
    return customFetch(target, options);
  } }).default;
  const render = () => { stateIndex = 0; refIndex = 0; effects.length = 0; return component(); };
  function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== "object" ? [] : [tree, ...nodes(tree.props?.children)]; }
  function text(tree) { return Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : String(tree ?? ""); }
  const button = (name) => nodes(render()).find((node) => node.type === "button" && text(node) === name);
  return { calls, render, button, text: () => text(render()), nodes: () => nodes(render()), mount() { render(); return effects[0](); } };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const uiPayload = (items = [item]) => ({ configuration: { ready: true, enabled: true, hasApiKey: true, hasCronSecret: true }, latestRun: null, history: [], result: {
  run_date: "2026-09-13", status: "success", completed_at: "2026-09-13T00:01:00Z", report: { items, searched_at: "2026-09-13T00:00:00Z" },
} });
test("panel loads saved data only; refreshing does not start a search", async () => {
  const view = ui(async () => Response.json(uiPayload())); view.mount(); await settle();
  assert.ok(view.text().includes(item.title));
  view.button("결과 새로고침").props.onClick(); await settle();
  assert.equal(view.calls.length, 2); assert.ok(view.calls.every((call) => !call.options.method));
});
test("rapid search clicks submit only once and controls unlock after failure", async () => {
  let finish;
  const view = ui(async (_url, options) => options.method === "POST" ? new Promise((resolve) => { finish = resolve; }) : Response.json(uiPayload()));
  view.mount(); await settle();
  const click = view.button("오늘 반응 검색").props.onClick; click(); click();
  assert.equal(view.calls.filter((call) => call.options.method === "POST").length, 1);
  assert.equal(view.button("검색 중…").props.disabled, true);
  finish(Response.json({ error: "검색 실패 · 이전 결과 유지" }, { status: 503 })); await settle();
  assert.ok(view.text().includes("검색 실패 · 이전 결과 유지"));
  assert.ok(view.text().includes(item.title)); assert.equal(view.button("오늘 반응 검색").props.disabled, false);
});
test("older responses cannot overwrite newer results", async () => {
  let first;
  let count = 0;
  const view = ui(async () => ++count === 1 ? new Promise((resolve) => { first = resolve; }) : Response.json(uiPayload([{ ...item, title: "새 결과" }])));
  view.mount(); view.button("결과 새로고침").props.onClick(); await settle();
  first(Response.json(uiPayload([{ ...item, title: "옛 결과" }]))); await settle();
  assert.ok(view.text().includes("새 결과")); assert.ok(!view.text().includes("옛 결과"));
});
test("no config never enables paid search; no successful report uses dashes, not misleading zero", async () => {
  const view = ui(async () => Response.json({ configuration: { ready: false }, result: null }));
  view.mount(); await settle();
  assert.equal(view.button("오늘 반응 검색").props.disabled, true);
  view.button("오늘 반응 검색").props.onClick(); await settle();
  assert.equal(view.calls.length, 1); assert.ok(view.text().includes("자동 검색 설정 대기")); assert.ok(view.text().includes("—"));
});
test("empty successful search does not claim positive reputation", async () => {
  const view = ui(async () => Response.json(uiPayload([]))); view.mount(); await settle();
  assert.ok(view.text().includes("반응이 전혀 없다는 뜻은 아니에요"));
});
test("mobile list is bounded to ten cards and pagination shows the rest", async () => {
  const view = ui(async () => Response.json(uiPayload(Array.from({ length: 13 }, (_, i) => ({ ...item, url: url + i, title: "예시 " + i })))));
  view.mount(); await settle();
  assert.equal(view.nodes().filter((node) => node.type === "article").length, 10);
  view.button("다음").props.onClick();
  assert.equal(view.nodes().filter((node) => node.type === "article").length, 3);
  assert.equal(view.button("다음").props.disabled, true);
});
test("source text cannot execute HTML; unsafe stored links are not rendered", async () => {
  const { renderToStaticMarkup } = require("react-dom/server");
  const view = ui(async () => Response.json(uiPayload([{ ...item, title: '<script>alert("x")</script>', url: "javascript:alert(1)" }])));
  view.mount(); await settle();
  const html = renderToStaticMarkup(view.render());
  assert.ok(!html.includes("<script>")); assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("PostgreSQL migration, private permissions, atomic claim, retries and retention", { skip: !process.env.PUBLIC_REACTION_PGLITE_PATH }, async () => {
  const { PGlite } = require(process.env.PUBLIC_REACTION_PGLITE_PATH);
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await db.exec(source("supabase/sql/admin_public_reactions.sql"));
    await db.exec(source("supabase/sql/admin_public_reactions.sql"));
    for (const role of ["anon", "authenticated"]) {
      await db.exec("set role " + role);
      await assert.rejects(() => db.query("select * from public.admin_public_reaction_runs"), /permission denied/);
      await assert.rejects(() => db.query("select * from public.claim_admin_public_reaction_run(false)"), /permission denied/);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    const claims = await Promise.all(Array.from({ length: 10 }, () => db.query("select * from public.claim_admin_public_reaction_run(false)")));
    assert.equal(claims.reduce((count, result) => count + result.rows.length, 0), 1);
    assert.equal((await db.query("select * from public.claim_admin_public_reaction_run(true)")).rows.length, 0);
    await db.exec("update public.admin_public_reaction_runs set status='failed', started_at=now()-interval '11 minutes'");
    assert.equal((await db.query("select * from public.claim_admin_public_reaction_run(false)")).rows.length, 0);
    const retry = await db.query("select * from public.claim_admin_public_reaction_run(true)");
    assert.equal(retry.rows[0].attempt, 2);
    assert.notEqual(retry.rows[0].run_token, claims.find((row) => row.rows.length).rows[0].run_token);
    await db.exec("update public.admin_public_reaction_runs set status='failed', started_at=now()-interval '11 minutes'");
    assert.equal((await db.query("select * from public.claim_admin_public_reaction_run(true)")).rows.length, 0);
    await db.exec("update public.admin_public_reaction_runs set status='success', report='{}', attempt=1");
    assert.equal((await db.query("select * from public.claim_admin_public_reaction_run(true)")).rows.length, 0);
    await db.exec("insert into public.admin_public_reaction_runs(run_date,status) values (current_date-100,'failed')");
    await db.query("select * from public.claim_admin_public_reaction_run(false)");
    assert.equal((await db.query("select count(*)::int as count from public.admin_public_reaction_runs")).rows[0].count, 1);
    const day = (await db.query("select (now() at time zone 'Asia/Seoul')::date::text as day")).rows[0].day;
    assert.equal((await db.query("select run_date::text as day from public.admin_public_reaction_runs")).rows[0].day, day);
  } finally { await db.close(); }
});
