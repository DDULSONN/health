/* eslint-disable @typescript-eslint/no-require-imports */
// Offline component event tests. No production data, email, card edits or sanctions.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const React = require("react");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const sourceTypes = ["open_card", "paid_card", "one_on_one", "open_card_application", "paid_card_application", "one_on_one_application"];
const snapshot = { contentFingerprint: "a".repeat(64), findingsFingerprint: "b".repeat(64) };
const fixture = (sourceType = "one_on_one") => ({ sourceType, cardId: "d731acf4-b825-4e69-92da-318cfd478a01",
  userId: "d731acf4-b825-4e69-92da-318cfd478a02", displayName: "한글 검수 회원", confirmationSnapshot: snapshot,
  suspicion_level: "high", flags: ["욕설 의심"], texts: { intro: "관리자가 확인할 원문" } });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return !tree || typeof tree !== "object" ? [] : [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  return Array.isArray(tree) ? tree.map(text).join("") : tree && typeof tree === "object" ? text(tree.props?.children) : String(tree ?? "");
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
function ui(items = [fixture()], options = {}) {
  const states = [], refs = [], calls = [];
  let stateIndex = 0, refIndex = 0;
  const code = ts.transpileModule(fs.readFileSync(path.join(root, "components/admin/AdminDatingCardAiReviewPanel.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const m = { exports: {} };
  new Function("require", "module", "exports", "fetch", "window", code)((id) => {
    if (id === "react") return { ...React, useEffect: () => {}, useCallback: (fn) => fn,
      useState: (initial) => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], (value) => { states[index] = typeof value === "function" ? value(states[index]) : value; }]; },
      useRef: (initial) => refs[refIndex++] ??= { current: initial },
    };
    if (id === "react/jsx-runtime") return require(id);
    throw new Error("Unexpected dependency: " + id);
  }, m, m.exports, async (url, init) => {
    assert.ok(url.startsWith("/api/admin/dating/card-ai-review"), "Normal confirmation must not call card deletion, ban, matching or email APIs");
    calls.push({ url, ...init });
    if (options.fetch) return options.fetch(url, init);
    if (!init?.method) return Response.json({ ok: true, items, ...options.list });
    const body = JSON.parse(init.body);
    assert.equal(init.method, "PATCH");
    assert.ok(["confirm_normal", "undo_confirmation"].includes(body.action));
    return options.reply ? options.reply(body) : Response.json({ ok: true, sourceType: body.sourceType, cardId: body.cardId, confirmationId: "saved-confirmation", message: "정상 확인 완료" });
  }, { confirm: () => { throw new Error("Reversible confirmation needs no blocking dialog"); }, prompt: () => { throw new Error("No ban dialog allowed"); } });
  const render = () => { stateIndex = 0; refIndex = 0; return m.exports.default(); };
  const buttons = (label) => nodes(render()).filter((node) => node.type === "button" && text(node) === label);
  return { render, buttons, calls, async load() { buttons("최근 결과")[0].props.onClick(); await settle(); } };
}

for (const source of sourceTypes) test(source + " confirmation hides only that result after server success", async () => {
  const item = fixture(source), other = { ...fixture(), cardId: "different-card" };
  const view = ui([item, other]); await view.load();
  view.buttons("✓ 정상 확인")[0].props.onClick(); await settle();
  const call = view.calls.find((entry) => entry.method === "PATCH");
  assert.deepEqual(JSON.parse(call.body), { action: "confirm_normal", sourceType: source, cardId: item.cardId, snapshot });
  assert.equal(view.buttons("✓ 정상 확인").length, 1);
  assert.ok(text(view.render()).includes("정상 확인 완료"));
});
for (const [label, reply] of [
  ["database failure", () => Response.json({ ok: false, message: "저장 실패" }, { status: 500 })],
  ["author changed content", () => Response.json({ ok: false, message: "다시 검수해 주세요." }, { status: 409 })],
  ["wrong result", (body) => Response.json({ ok: true, sourceType: body.sourceType, cardId: "another-card", confirmationId: "x" })],
  ["no persisted id", (body) => Response.json({ ok: true, sourceType: body.sourceType, cardId: body.cardId })],
  ["invalid response", () => new Response("invalid")],
  ["network failure", () => { throw new Error("network unavailable"); }],
]) test(label + " keeps the card visible and releases controls", async () => {
  const view = ui([fixture()], { reply }); await view.load();
  view.buttons("✓ 정상 확인")[0].props.onClick(); await settle();
  assert.equal(view.buttons("✓ 정상 확인").length, 1);
  assert.equal(view.buttons("✓ 정상 확인")[0].props.disabled, false);
  assert.equal(view.buttons("일반 검수")[0].props.disabled, false);
});
test("double-click sends one request and prevents overlapping scans/ban while saving", async () => {
  let resolve;
  const view = ui([fixture()], { reply: () => new Promise((done) => { resolve = done; }) }); await view.load();
  const click = view.buttons("✓ 정상 확인")[0].props.onClick;
  click(); click();
  assert.equal(view.calls.filter((call) => call.method === "PATCH").length, 1);
  assert.equal(view.buttons("일반 검수")[0].props.disabled, true);
  assert.equal(view.buttons("계정 밴")[0].props.disabled, true);
  assert.equal(view.buttons("정상 확인 목록")[0].props.disabled, true);
  resolve(Response.json({ ok: true, sourceType: fixture().sourceType, cardId: fixture().cardId, confirmationId: "saved" })); await settle();
  assert.equal(view.buttons("✓ 정상 확인").length, 0);
});
test("old or unsaved results cannot be confirmed even if their disabled handler is invoked", async () => {
  const view = ui([{ ...fixture(), confirmationSnapshot: null }], { list: { warning: "DB 설정을 확인해 주세요." } }); await view.load();
  const button = view.buttons("재검수 필요")[0]; assert.equal(button.props.disabled, true);
  button.props.onClick(); await settle();
  assert.equal(view.calls.filter((call) => call.method).length, 0);
  assert.ok(nodes(view.render()).some((node) => node.props?.role === "alert" && text(node).includes("DB 설정")));
});
test("confirmed list allows explicit undo with the exact confirmation ID", async () => {
  const item = { ...fixture(), confirmationId: "exact-confirmation", confirmedAt: "2026-09-14T00:00:00Z", confirmationCurrent: true };
  const view = ui([item]); await view.load();
  view.buttons("정상 확인 목록")[0].props.onClick(); await view.load();
  assert.ok(view.calls.some((call) => call.url.includes("view=confirmed")));
  view.buttons("정상 확인 취소")[0].props.onClick(); await settle();
  assert.equal(JSON.parse(view.calls.find((call) => call.method === "PATCH").body).confirmationId, "exact-confirmation");
  assert.equal(view.buttons("정상 확인 취소").length, 0);
});
test("clicking the already selected list does not empty it", async () => {
  const view = ui(); await view.load();
  view.buttons("확인할 항목")[0].props.onClick();
  assert.equal(view.buttons("✓ 정상 확인").length, 1);
});
test("pagination remains available when a page contains only hidden results", async () => {
  const view = ui([], { list: { nextOffset: 250 } }); await view.load();
  view.buttons("다음 결과 더보기")[0].props.onClick(); await settle();
  assert.ok(view.calls.some((call) => call.url.includes("offset=250")));
});
test("a late list response cannot replace the latest list response", async () => {
  const pending = [];
  const view = ui([], { fetch: () => new Promise((resolve) => pending.push(resolve)) });
  view.buttons("최근 결과")[0].props.onClick();
  view.buttons("최근 결과")[0].props.onClick();
  pending[1](Response.json({ ok: true, items: [fixture()] })); await settle();
  pending[0](Response.json({ ok: true, items: [] })); await settle();
  assert.equal(view.buttons("✓ 정상 확인").length, 1);
});
