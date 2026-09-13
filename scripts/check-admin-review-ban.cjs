/* eslint-disable @typescript-eslint/no-require-imports */
// Offline UI event and route fixtures. Never operate on real accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const React = require("react");
const root = path.resolve(__dirname, "..");
const uid = (n) => `d731acf4-b825-4e69-92da-318cfd478a${n.toString(16).padStart(2, "0")}`;
const adminId = uid(1), authorId = uid(2), peerId = uid(3);
const sources = ["open_card", "paid_card", "one_on_one", "open_card_application", "paid_card_application", "one_on_one_application"];
function compile(file, resolve, fetch, window) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const m = { exports: {} };
  new Function("require", "module", "exports", "fetch", "window", code)(resolve, m, m.exports, fetch, window);
  return m.exports;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  return tree && typeof tree === "object" ? text(tree.props?.children) : String(tree ?? "");
}
const settle = async () => { for (let n = 0; n < 5; n++) await new Promise(setImmediate); };
function item(sourceType = "one_on_one", userId = authorId, legacy = false) {
  const common = { texts: { candidateUserId: peerId, intro: "테스트 소개" }, flags: ["소개 내용 부족"], suspicion_level: "medium" };
  return legacy ? { ...common, source_type: sourceType, card_id: uid(10), user_id: userId, display_name: "민수 (닉네임: 차분한회원)" }
    : { ...common, sourceType, cardId: uid(11), userId, displayName: "민수 (닉네임: 차분한회원)" };
}
const success = (extra = {}) => Response.json({ ok: true, user_id: authorId, profile: { user_id: authorId, is_banned: true }, ...extra });
function ui(items, options = {}) {
  const states = [], refs = [], calls = [], dialogs = [];
  let index = 0, refIndex = 0;
  const Panel = compile("components/admin/AdminDatingCardAiReviewPanel.tsx", (id) => {
    if (id === "react") return { ...React, useEffect: () => {}, useCallback: (fn) => fn,
      useState: (initial) => { const i = index++; if (!(i in states)) states[i] = initial; return [states[i], (value) => { states[i] = typeof value === "function" ? value(states[i]) : value; }]; },
      useRef: (initial) => refs[refIndex++] ??= { current: initial },
    };
    if (id === "react/jsx-runtime") return require(id);
    throw new Error("Unexpected UI dependency: " + id);
  }, async (url, init) => {
    if (!init?.method) return Response.json({ ok: true, items });
    calls.push({ url, ...init });
    assert.equal(url, "/api/admin/users/ban");
    assert.equal(init.method, "POST");
    return options.reply ? options.reply() : success();
  }, {
    prompt: (...args) => { dialogs.push(["prompt", ...args]); return "reason" in options ? options.reason : "프로필 운영정책 위반 확인"; },
    confirm: (...args) => { dialogs.push(["confirm", ...args]); return options.confirm !== false; },
  }).default;
  const render = () => { index = 0; refIndex = 0; return Panel(); };
  const buttons = (label) => nodes(render()).filter((n) => n.type === "button" && text(n) === label);
  return { render, buttons, calls, dialogs, async load() { buttons("최근 결과")[0].props.onClick(); await settle(); } };
}
for (const source of sources) for (const legacy of [false, true]) {
  test(`${source} ${legacy ? "saved" : "fresh"} result bans its author, not the recipient`, async () => {
    const view = ui([item(source, authorId, legacy)]);
    await view.load();
    const button = view.buttons("계정 밴")[0];
    assert.equal(button.props.disabled, false);
    button.props.onClick(); await settle();
    assert.equal(view.calls.length, 1);
    assert.deepEqual(JSON.parse(view.calls[0].body), { userId: authorId, banned: true, reason: "프로필 운영정책 위반 확인" });
    assert.ok(view.dialogs.find(([kind, message]) => kind === "confirm" && message.includes(authorId) && message.includes("민수") && message.includes("상대방이 아닌")));
    assert.equal(view.buttons("밴 완료")[0].props.disabled, true);
  });
}
for (const options of [{ reason: null }, { reason: " " }, { reason: "가".repeat(301) }, { confirm: false }]) {
  test("cancelling or invalid reason sends no ban request: " + JSON.stringify(options).slice(0, 60), async () => {
    const view = ui([item()], options); await view.load();
    view.buttons("계정 밴")[0].props.onClick(); await settle();
    assert.equal(view.calls.length, 0);
  });
}
test("missing account disables ban even if handler is invoked", async () => {
  const view = ui([item("open_card", null)]); await view.load();
  assert.equal(view.buttons("계정 밴")[0].props.disabled, true);
  view.buttons("계정 밴")[0].props.onClick(); await settle();
  assert.equal(view.calls.length, 0); assert.equal(view.dialogs.length, 0);
});
test("double-click sends once and marks all rows belonging to that account", async () => {
  let resolveRequest;
  const view = ui([item(), item("open_card", authorId, true), item("paid_card", peerId)], {
    reply: () => new Promise((resolve) => { resolveRequest = resolve; }),
  });
  await view.load(); const click = view.buttons("계정 밴")[0].props.onClick;
  click(); click();
  assert.equal(view.calls.length, 1);
  assert.equal(view.buttons("일반 검수")[0].props.disabled, true);
  assert.equal(view.buttons("최근 결과")[0].props.disabled, true);
  resolveRequest(success()); await settle();
  assert.equal(view.buttons("밴 완료").length, 2);
  assert.equal(view.buttons("계정 밴").length, 1);
});
for (const [label, reply] of [
  ["API failure", () => Response.json({ error: "회원 정지 실패" }, { status: 500 })],
  ["wrong account", () => success({ user_id: peerId })],
  ["wrong profile", () => success({ profile: { user_id: peerId, is_banned: true } })],
  ["no persisted ban", () => success({ profile: { user_id: authorId, is_banned: false } })],
  ["invalid response", () => new Response("not-json")],
  ["network failure", () => { throw new Error("Connection lost"); }],
]) test(label + " never shows ban complete and releases busy state", async () => {
  const view = ui([item()], { reply }); await view.load();
  view.buttons("계정 밴")[0].props.onClick(); await settle();
  assert.equal(view.buttons("밴 완료").length, 0);
  assert.equal(view.buttons("계정 밴")[0].props.disabled, false);
});
test("partial card cleanup is a warning, while the persisted account ban stays visible", async () => {
  const warning = "계정 밴은 완료됐지만 일부 카드 내리기에 실패했습니다.";
  const view = ui([item()], { reply: () => success({ warning }) }); await view.load();
  view.buttons("계정 밴")[0].props.onClick(); await settle();
  assert.equal(view.buttons("밴 완료").length, 1);
  assert.ok(nodes(view.render()).some((n) => n.props?.role === "alert" && text(n) === warning));
});

function api(options = {}) {
  const tables = { profiles: [{ user_id: authorId, role: options.role || "user", is_banned: false }],
    dating_cards: [{ id: uid(20), owner_user_id: authorId, status: "public", sex: "male" }, { id: uid(21), owner_user_id: peerId, status: "public", sex: "female" }],
    dating_paid_cards: [{ id: uid(22), user_id: authorId, status: "approved" }],
    dating_1on1_cards: [{ id: uid(23), user_id: authorId, status: "approved" }],
  };
  const writes = [], audits = [], promotions = [];
  const admin = { auth: { admin: { getUserById: async () => ({ data: { user: { email: "fixture@example.test" } } }) } },
    from(table) {
      assert.ok(table in tables, "Unexpected table: " + table);
      const q = { filters: [], single: false }; const b = {};
      b.select = () => b; b.eq = (k, v) => { q.filters.push((r) => r[k] === v); return b; };
      b.in = (k, v) => { q.filters.push((r) => v.includes(r[k])); return b; };
      b.maybeSingle = () => { q.single = true; return b; };
      b.update = (values) => { q.values = values; return b; };
      b.then = (resolve, reject) => Promise.resolve().then(() => {
        if (q.values && options.failTable === table) return { data: null, error: { message: "fixture failure" } };
        let rows = tables[table].filter((r) => q.filters.every((f) => f(r)));
        if (q.values) {
          if (options.missingOnUpdate && table === "profiles") rows = [];
          if (rows.length) writes.push({ table, values: q.values });
          rows.forEach((r) => Object.assign(r, q.values));
        }
        return { data: structuredClone(q.single ? rows[0] ?? null : rows), error: null };
      }).then(resolve, reject);
      return b;
    },
  };
  const route = compile("app/api/admin/users/ban/route.ts", (id) => {
    if (id === "next/server") return { NextResponse: { json: (body, init) => Response.json(body, init) } };
    if (id === "@/lib/admin-route") return { requireAdminRoute: async () => options.denied
      ? { ok: false, response: Response.json({ error: "관리자만 가능" }, { status: 403 }) }
      : { ok: true, admin, user: { id: options.self ? authorId : adminId } } };
    if (id === "@/lib/admin") return { isAllowedAdminUser: () => !!options.allowedAdmin };
    if (id === "@/lib/admin-audit") return { recordAdminAuditEvent: async (event) => audits.push(event) };
    if (id === "@/lib/dating-cards-queue") return { promotePendingCardsBySex: async (_db, sex) => promotions.push(sex) };
    throw new Error("Unexpected route dependency: " + id);
  }, () => { throw new Error("Unexpected real network request"); });
  return { tables, writes, audits, promotions, post: (body = {}) => route.POST(new Request("https://fixture.invalid/api/admin/users/ban", {
    method: "POST", body: JSON.stringify({ userId: authorId, banned: true, reason: "한글 밴 사유", ...body }),
  })) };
}
test("existing ban route limits only the requested account and its cards, retaining audit and queue behavior", async () => {
  const fixture = api(), response = await fixture.post(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.profile.is_banned, true);
  assert.equal(body.profile.banned_reason, "한글 밴 사유");
  assert.equal(body.profile.swipe_profile_visible, false);
  assert.equal(fixture.tables.dating_cards[0].status, "hidden");
  assert.equal(fixture.tables.dating_cards[1].status, "public");
  assert.equal(fixture.tables.dating_paid_cards[0].status, "expired");
  assert.equal(fixture.tables.dating_1on1_cards[0].status, "rejected");
  assert.deepEqual(fixture.promotions, ["male"]);
  assert.equal(fixture.audits.at(-1).targetId, authorId);
  assert.equal(body.warning, undefined);
});
for (const options of [{ denied: true }, { self: true }, { role: "admin" }, { allowedAdmin: true }, { failTable: "profiles" }, { missingOnUpdate: true }]) {
  test("unauthorized or unpersisted ban cannot modify cards: " + JSON.stringify(options), async () => {
    const fixture = api(options), response = await fixture.post();
    assert.ok(response.status >= 400);
    assert.equal(fixture.writes.length, 0); assert.equal(fixture.promotions.length, 0);
  });
}
test("deleted user cannot be banned", async () => {
  const fixture = api();
  assert.equal((await fixture.post({ userId: uid(99) })).status, 404);
  assert.equal(fixture.writes.length, 0);
});
test("card cleanup failure returns an explicit warning without pretending the account ban failed", async () => {
  const fixture = api({ failTable: "dating_cards" }), body = await (await fixture.post()).json();
  assert.equal(body.ok, true); assert.equal(body.profile.is_banned, true);
  assert.match(body.warning, /일부 카드 내리기에 실패/);
  assert.equal(fixture.audits.at(-1).metadata.card_cleanup_failed, true);
});
test("existing unban behavior remains unchanged and does not republish cards", async () => {
  const fixture = api(), body = await (await fixture.post({ banned: false })).json();
  assert.equal(body.profile.is_banned, false);
  assert.deepEqual(fixture.writes.map((w) => w.table), ["profiles"]);
  assert.equal(fixture.promotions.length, 0);
});
