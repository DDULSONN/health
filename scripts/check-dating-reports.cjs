/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated report-route regression tests. No production DB, SMS or payments.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reporter = uid(1), other = uid(2), outsider = uid(3), cardId = uid(10), ownId = uid(11), appId = uid(20), matchId = uid(30);

function database(initial, options = {}) {
  const tables = structuredClone(initial);
  const calls = [];
  const admin = { from(table) {
    const q = { table, op: "select", filters: [], orders: [], fields: "*", offset: 0, end: Infinity };
    const builder = {};
    for (const method of ["select", "eq", "is", "in", "or", "order", "limit", "range", "insert", "upsert", "update"]) {
      builder[method] = (...args) => {
        if (["insert", "upsert", "update"].includes(method)) { q.op = method; q.payload = args[0]; }
        else if (method === "select") { q.fields = args[0]; q.head = args[1]?.head; }
        else if (method === "order") q.orders.push(args);
        else if (method === "range") [q.offset, q.end] = args;
        else if (method === "limit") q.end = args[0] - 1;
        else q.filters.push([method, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = () => { q.single = true; return builder; };
    builder.then = (yes, no) => Promise.resolve().then(() => {
      calls.push(structuredClone(q));
      const error = options.fail?.(q);
      if (error instanceof Error) throw error;
      if (error) return { data: null, count: null, error };
      if (options.legacy && table === "dating_user_reports" &&
        (q.fields.includes("evidence_snapshot") || q.payload?.evidence_snapshot)) {
        return { data: null, count: null, error: { code: "42703", message: "evidence_snapshot column missing" } };
      }
      tables[table] ??= [];
      const evaluateOr = (row, value) => value.split(/,(?=and\()/).some((group) =>
        group.replace(/^and\(/, "").replace(/\)$/, "").split(",").every((clause) => {
          const [field, operator, wanted] = clause.split(".");
          assert.equal(operator, "eq");
          return row[field] === wanted;
        })
      );
      let rows = tables[table].filter((row) => q.filters.every(([method, field, value]) => {
        if (method === "eq" || method === "is") return row[field] === value;
        if (method === "in") return value.includes(row[field]);
        if (method === "or") return evaluateOr(row, field);
        throw new Error("unhandled filter " + method);
      }));
      if (q.op === "insert") {
        const duplicate = tables[table].some((row) => row.reporter_user_id === q.payload.reporter_user_id &&
          (table === "dating_card_reports" ? row.card_id === q.payload.card_id : row.target_type === q.payload.target_type && row.target_id === q.payload.target_id));
        if (duplicate) return { data: null, error: { code: "23505" } };
        rows = [{ id: uid(100 + tables[table].length), status: "open", created_at: new Date().toISOString(), ...q.payload }];
        tables[table].push(...rows);
      }
      if (q.op === "upsert") {
        assert.equal(table, "dating_user_blocks");
        const existing = tables[table].find((row) => row.blocker_user_id === q.payload.blocker_user_id && row.blocked_user_id === q.payload.blocked_user_id);
        if (existing) Object.assign(existing, q.payload);
        else tables[table].push(structuredClone(q.payload));
      }
      if (q.op === "update") rows.forEach((row) => Object.assign(row, q.payload));
      for (const [field, config] of [...q.orders].reverse()) rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (config?.ascending ? 1 : -1));
      const count = rows.length;
      rows = rows.slice(q.offset, q.end + 1);
      const projected = rows.map((row) => q.fields === "*" ? row : Object.fromEntries(q.fields.split(",").map((field) => field.trim()).map((field) => [field, row[field]])));
      return { error: null, count, data: q.head ? null : q.single ? projected[0] ?? null : projected };
    }).then(yes, no);
    return builder;
  } };
  admin.auth = { admin: { getUserById: async (id) => ({ data: { user: { id, email: "fixture@example.com" } }, error: null }) } };
  return { admin, tables, calls };
}

function load(file, db, options = {}) {
  const cache = new Map();
  const overrides = {
    "@/lib/supabase/server": { createAdminClient: () => db.admin },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: options.noUser ? null : { id: options.userId ?? reporter } }) },
    "@/lib/admin-route": { requireAdminRoute: async () => options.noAdmin
      ? { ok: false, response: Response.json({ error: "권한 없음" }, { status: 403 }) }
      : { ok: true, user: { id: reporter }, admin: db.admin } },
    "@/lib/admin": { isAllowedAdminUser: (id) => id === reporter },
    "@/lib/dating-more-view": { hasMoreViewAccess: async () => Boolean(options.pendingAccess) },
    "@/lib/dating-city-view": { hasCityViewCardAccess: async () => false },
    "@/lib/dating-chat": { isMissingDatingChatRelation: () => false },
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  };
  const resolve = (name) => {
    if (name in overrides) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    const target = name.slice(2) + ".ts";
    if (cache.has(target)) return cache.get(target);
    const result = compile(target);
    cache.set(target, result);
    return result;
  };
  const compile = (target) => {
    const source = fs.readFileSync(path.join(root, target), "utf8");
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const loadedModule = { exports: {} };
    new Function("require", "module", "exports", code)(resolve, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  };
  return compile(file);
}

function initial() {
  return {
    profiles: [{ user_id: reporter, nickname: "신고자" }, { user_id: other, nickname: "테스트회원" }],
    dating_cards: [{ id: cardId, owner_user_id: other, display_nickname: "오픈카드", status: "public", sex: "male", expires_at: "2099-01-01" }],
    dating_paid_cards: [{ id: cardId, user_id: other }],
    dating_card_applications: [{ id: appId, card_id: cardId, applicant_user_id: reporter, intro_text: "한글 지원서" }],
    dating_paid_card_applications: [{ id: appId, paid_card_id: cardId, applicant_user_id: reporter }],
    dating_1on1_cards: [
      { id: cardId, user_id: other, name: "상대 이름", intro_text: "테스트 소개", phone: "PRIVATE_PHONE", email: "PRIVATE_EMAIL", instagram_id: "PRIVATE_INSTAGRAM", photo_paths: ["PRIVATE_PHOTO"] },
      { id: ownId, user_id: reporter, status: "submitted" },
    ],
    dating_1on1_match_proposals: [{ id: matchId, source_user_id: reporter, candidate_user_id: other, source_card_id: ownId, candidate_card_id: cardId,
      state: "source_selected", contact_exchange_status: "none", contact_exchange_paid_at: null, contact_exchange_approved_at: null }],
    dating_user_reports: [], dating_card_reports: [], dating_user_blocks: [],
  };
}
function request(body, url = "http://localhost/api/dating/user-reports", method = "POST") {
  return new Request(url, { method, headers: { "Content-Type": "application/json", host: "localhost", origin: "http://localhost" }, body: JSON.stringify(body) });
}
const userPath = "app/api/dating/user-reports/route.ts", openPath = "app/api/dating/cards/report/route.ts";
const userBody = { target_type: "one_on_one_match", target_id: matchId, reason_code: "safety_risk", detail: "연락 후 불쾌한 언행이 있었습니다." };
async function submit(file, data, options, body) {
  const db = database(data, options);
  const route = load(file, db, options);
  const res = await route.POST(request(body));
  return { db, route, res, body: await res.json() };
}

for (const [type, id] of [["open_card_application", appId], ["paid_card_application", appId], ["one_on_one_card", cardId], ["one_on_one_match", matchId]]) {
  test(type + " resolves the correct reported person", async () => {
    const result = await submit(userPath, initial(), {}, { ...userBody, target_type: type, target_id: id });
    assert.equal(result.res.status, 200);
    assert.equal(result.db.tables.dating_user_reports[0].reported_user_id, other);
    assert.equal(result.body.blocked, true);
    assert.ok(result.db.tables.dating_user_reports[0].reason.includes(userBody.detail));
  });
}
for (const type of ["open_card_application", "paid_card_application", "one_on_one_match"]) {
  test(type + " received side reports the sender", async () => {
    const result = await submit(userPath, initial(), { userId: other }, { ...userBody, target_type: type, target_id: type === "one_on_one_match" ? matchId : appId });
    assert.equal(result.res.status, 200);
    assert.equal(result.db.tables.dating_user_reports[0].reported_user_id, reporter);
  });
}
for (const [name, options, body, status] of [
  ["logged out", { noUser: true }, userBody, 401],
  ["unrelated match", { userId: outsider }, userBody, 403],
  ["invalid ID", {}, { ...userBody, target_id: "not-a-uuid" }, 400],
  ["invalid reason", {}, { ...userBody, reason_code: "bad" }, 400],
  ["self card", {}, { ...userBody, target_type: "one_on_one_card", target_id: ownId }, 403],
  ["target DB error", { fail: (q) => q.table === "dating_1on1_match_proposals" ? { code: "XX000" } : null }, userBody, 500],
]) test(name + " does not persist a report or block", async () => {
  const result = await submit(userPath, initial(), options, body);
  assert.equal(result.res.status, status);
  assert.equal(result.db.tables.dating_user_reports.length, 0);
  assert.equal(result.db.tables.dating_user_blocks.length, 0);
});
test("cross-origin reporting is rejected", async () => {
  const db = database(initial()), route = load(openPath, db);
  const req = request({ card_id: cardId, reason_code: "fake_profile" });
  req.headers.set("origin", "https://untrusted.invalid");
  assert.equal((await route.POST(req)).status, 403);
  assert.equal(db.calls.length, 0);
});
test("legacy schema accepts reports, but never stores contact data", async () => {
  const result = await submit(userPath, initial(), { legacy: true }, userBody);
  assert.equal(result.body.ok, true);
  assert.equal(result.db.tables.dating_user_reports.length, 1);
  assert.equal(result.db.tables.dating_user_reports[0].evidence_snapshot, undefined);
});
test("snapshot whitelist excludes contacts and original image URLs", async () => {
  const result = await submit(userPath, initial(), {}, userBody);
  const evidence = result.db.tables.dating_user_reports[0].evidence_snapshot;
  assert.equal(evidence.card.name, "상대 이름");
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_/);
});
for (const file of [userPath, openPath]) {
  const payload = file === openPath ? { card_id: cardId, reason_code: "fake_profile", detail: "최초 신고" } : userBody;
  test(file + " duplicate retry preserves original reason and closed status", async () => {
    const result = await submit(file, initial(), {}, payload);
    const table = file === openPath ? "dating_card_reports" : "dating_user_reports";
    const original = structuredClone(result.db.tables[table][0]);
    result.db.tables[table][0].status = "resolved";
    const retry = await result.route.POST(request({ ...payload, detail: "다른 내용" }));
    assert.equal((await retry.json()).already_reported, true);
    assert.equal(result.db.tables[table].length, 1);
    assert.equal(result.db.tables[table][0].reason, original.reason);
    assert.equal(result.db.tables[table][0].status, "resolved");
  });
  for (const thrown of [false, true]) test(file + " saved report survives block failure " + thrown, async () => {
    const result = await submit(file, initial(), { fail: (q) => q.table === "dating_user_blocks" ? thrown ? new Error("simulated network") : { code: "XX000" } : null }, payload);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.blocked, false);
    assert.ok(result.body.message.includes("차단을 완료하지 못했습니다"));
    assert.equal(result.db.tables.dating_1on1_match_proposals[0].state, "source_selected");
  });
  test(file + " insert failure must not block", async () => {
    const result = await submit(file, initial(), { fail: (q) => q.op === "insert" ? { code: "XX000" } : null }, payload);
    assert.equal(result.res.status, 500);
    assert.equal(result.db.tables.dating_user_blocks.length, 0);
  });
}
for (const protectedMatch of [
  { state: "mutual_accepted", contact_exchange_status: "approved" },
  { contact_exchange_status: "payment_pending_admin" },
  { contact_exchange_paid_at: "2026-09-09T00:00:00Z" },
  { contact_exchange_approved_at: "2026-09-09T00:00:00Z" },
  { state: "candidate_rejected" },
]) test("report does not cancel " + JSON.stringify(protectedMatch), async () => {
  const data = initial();
  Object.assign(data.dating_1on1_match_proposals[0], protectedMatch);
  const before = structuredClone(data.dating_1on1_match_proposals[0]);
  const result = await submit(userPath, data, {}, userBody);
  assert.equal(result.body.ok, true);
  assert.deepEqual(result.db.tables.dating_1on1_match_proposals[0], before);
});
test("pending cleanup failure is truthful and does not undo receipt", async () => {
  const result = await submit(userPath, initial(), { fail: (q) => q.op === "update" ? new Error("cleanup offline") : null }, userBody);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.blocked, true);
  assert.equal(result.body.pending_matches_canceled, false);
});
for (const [name, overrides, status] of [
  ["private expired", { expires_at: "2020-01-01" }, 403],
  ["self open card", { owner_user_id: reporter }, 400],
  ["public card", {}, 201],
  ["paid access pending", { status: "pending" }, 201],
]) test(name, async () => {
  const data = initial();
  Object.assign(data.dating_cards[0], overrides);
  const result = await submit(openPath, data, { pendingAccess: name === "paid access pending" }, { card_id: cardId, reason_code: "fake_profile" });
  assert.equal(result.res.status, status);
});

test("admin listing filters before pagination and sees older open reports", async () => {
  const data = initial();
  data.dating_user_reports = Array.from({ length: 620 }, (_, index) => ({
    id: uid(index + 1000), reporter_user_id: reporter, reported_user_id: other, target_type: "one_on_one_match",
    status: index < 560 ? "resolved" : "open", created_at: String(10000 - index), reason: "테스트",
  }));
  const db = database(data);
  const route = load("app/api/admin/dating/user-reports/route.ts", db);
  const first = await (await route.GET(new Request("http://localhost?status=open&limit=50"))).json();
  const second = await (await route.GET(new Request("http://localhost?status=open&limit=50&offset=50"))).json();
  assert.equal(first.items.length, 50); assert.equal(first.total, 60); assert.equal(first.unresolved_total, 60); assert.equal(first.has_more, true);
  assert.equal(second.items.length, 10); assert.equal(second.has_more, false);
  assert.equal(new Set([...first.items, ...second.items].map((row) => row.id)).size, 60);
  const closed = await (await route.GET(new Request("http://localhost?status=closed&limit=10"))).json();
  assert.equal(closed.total, 560); assert.ok(closed.items.every((row) => row.status === "resolved"));
});
test("admin missing evidence schema is disclosed", async () => {
  const db = database(initial(), { legacy: true });
  const route = load("app/api/admin/dating/user-reports/route.ts", db);
  const body = await (await route.GET(new Request("http://localhost?limit=50"))).json();
  assert.equal(body.evidence_available, false);
  assert.deepEqual(body.items, []);
});
for (const kind of ["reports", "user-reports", "chat-reports"]) {
  test("non-admin cannot list " + kind, async () => {
    const db = database(initial());
    const route = load("app/api/admin/dating/" + kind + "/route.ts", db, { noAdmin: true });
    assert.equal((await route.GET(new Request("http://localhost"))).status, 403);
    assert.equal(db.calls.length, 0);
  });
  test("missing " + kind + " cannot return successful PATCH", async () => {
    const db = database(initial());
    const route = load("app/api/admin/dating/" + kind + "/[id]/route.ts", db);
    const res = await route.PATCH(request({ status: "resolved" }, "http://localhost", "PATCH"), { params: Promise.resolve({ id: uid(900) }) });
    assert.equal(res.status, 404);
  });
}
test("admin evidence recapture preserves original and does not wrap query responses", async () => {
  const data = initial();
  data.dating_user_reports = [{ id: uid(900), target_type: "one_on_one_match", target_id: matchId, target_card_id: cardId, evidence_snapshot: { card: { name: "신고 당시 이름", phone: "PRIVATE_PHONE" } } }];
  const db = database(data);
  const route = load("app/api/admin/dating/user-reports/[id]/route.ts", db);
  const res = await route.PATCH(request({ preserve_evidence: true }, "http://localhost", "PATCH"), { params: Promise.resolve({ id: uid(900) }) });
  assert.equal(res.status, 200);
  const snapshot = db.tables.dating_user_reports[0].evidence_snapshot;
  assert.equal(snapshot.card.name, "신고 당시 이름");
  assert.equal(snapshot.latest.card.name, "상대 이름");
  assert.equal(snapshot.target.data, undefined);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE_/);
});
test("legacy evidence action rejects clearly but ordinary status update still works", async () => {
  const data = initial();
  data.dating_user_reports = [{ id: uid(900), target_type: "one_on_one_match", target_id: matchId, target_card_id: cardId }];
  const db = database(data, { legacy: true });
  const route = load("app/api/admin/dating/user-reports/[id]/route.ts", db);
  const ctx = { params: Promise.resolve({ id: uid(900) }) };
  assert.equal((await route.PATCH(request({ preserve_evidence: true }, "http://localhost", "PATCH"), ctx)).status, 409);
  assert.equal((await route.PATCH(request({ status: "resolved" }, "http://localhost", "PATCH"), ctx)).status, 200);
  assert.equal(db.tables.dating_user_reports[0].reviewed_by_user_id, reporter);
});

test("simultaneous submissions produce one report", async () => {
  const db = database(initial()), route = load(userPath, db);
  const responses = await Promise.all([route.POST(request(userBody)), route.POST(request(userBody))]);
  assert.ok(responses.every((res) => res.status === 200));
  assert.equal(db.tables.dating_user_reports.length, 1);
});
for (const failureTable of ["profiles", "dating_cards", null]) test("admin ban resolution order: " + (failureTable ?? "success"), async () => {
  const data = initial();
  data.dating_card_reports = [{ id: uid(900), card_id: cardId, reason: "테스트 신고", status: "open" }];
  const db = database(data, { fail: (q) => q.op === "update" && q.table === failureTable ? { code: "XX000" } : null });
  const route = load("app/api/admin/dating/reports/[id]/ban/route.ts", db);
  const response = await route.POST(request({}, "http://localhost"), { params: Promise.resolve({ id: uid(900) }) });
  assert.equal(response.status, failureTable ? 500 : 200);
  assert.equal(db.tables.dating_card_reports[0].status, failureTable ? "open" : "resolved");
});
test("evidence migration is additive and safe to re-run", { skip: !process.env.REPORT_TEST_PGLITE_PATH }, async () => {
  const { PGlite } = require(process.env.REPORT_TEST_PGLITE_PATH);
  const db = new PGlite();
  try {
    await db.exec("create schema auth; create table auth.users(id uuid primary key); create table public.dating_user_reports(id uuid primary key, reason text, status text); insert into public.dating_user_reports values ('" + uid(900) + "', '한글 신고 원본', 'open');");
    const sql = fs.readFileSync(path.join(root, "supabase/sql/dating_report_evidence_columns.sql"), "utf8");
    await db.exec(sql); await db.exec(sql);
    const result = await db.query("select reason,status,evidence_snapshot,action_type from public.dating_user_reports");
    assert.deepEqual(result.rows, [{ reason: "한글 신고 원본", status: "open", evidence_snapshot: {}, action_type: "none" }]);
  } finally { await db.close(); }
});
