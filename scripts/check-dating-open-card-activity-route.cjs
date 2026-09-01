/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const day = 24 * 60 * 60 * 1000;
const isoAgo = (days) => new Date(Date.now() - days * day).toISOString();

function mockDatabase(initial, options = {}) {
  const tables = structuredClone(initial);
  const sends = [];
  const from = (table) => {
    const query = { table, filters: [], orders: [], from: 0, to: Infinity, fields: "*" };
    const execute = async () => {
      if (options.missingActivitySchema && table === "dating_cards" && query.fields.includes("inactivity_notice_sent_at")) {
        return { data: null, error: { code: "42703", message: "column does not exist" } };
      }
      tables[table] ??= [];
      const matches = (row) => query.filters.every(([operator, key, value]) => {
        if (operator === "eq") return row[key] === value;
        if (operator === "gte") return Number(row[key]) >= Number(value);
        if (operator === "in") return value.includes(row[key]);
        if (operator === "contains") return Object.entries(value).every(([nestedKey, nestedValue]) => row[key]?.[nestedKey] === nestedValue);
        throw new Error(`unsupported filter: ${operator}`);
      });
      let rows = tables[table].filter(matches);
      for (const [key, ascending] of [...query.orders].reverse()) {
        rows.sort((a, b) => String(a[key] ?? "").localeCompare(String(b[key] ?? "")) * (ascending ? 1 : -1));
      }
      rows = rows.slice(query.from, query.to + 1);
      if (query.update) {
        for (const row of rows) Object.assign(row, structuredClone(query.update));
      }
      if (query.insert) {
        const values = Array.isArray(query.insert) ? query.insert : [query.insert];
        for (const value of values) tables[table].push({ id: `insert-${tables[table].length + 1}`, sent_at: new Date().toISOString(), ...structuredClone(value) });
        rows = values;
      }
      const projected = query.fields === "*" ? rows : rows.map((row) => Object.fromEntries(
        query.fields.split(",").map((field) => field.trim()).filter(Boolean).map((field) => [field, row[field]])
      ));
      return { data: structuredClone(projected), error: null };
    };
    const builder = {
      select(fields) { query.fields = fields; return builder; },
      eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
      gte(key, value) { query.filters.push(["gte", key, value]); return builder; },
      in(key, value) { query.filters.push(["in", key, value]); return builder; },
      contains(key, value) { query.filters.push(["contains", key, value]); return builder; },
      order(key, config = {}) { query.orders.push([key, config.ascending !== false]); return builder; },
      range(fromIndex, toIndex) { query.from = fromIndex; query.to = toIndex; return builder; },
      update(value) { query.update = value; return builder; },
      insert(value) { query.insert = value; return builder; },
      async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return builder;
  };
  const users = structuredClone(initial.auth_users ?? []);
  const admin = {
    from,
    auth: { admin: { listUsers: async ({ page, perPage }) => ({
      data: { users: users.slice((page - 1) * perPage, page * perPage) },
      error: null,
    }) } },
  };
  return { admin, tables, sends };
}

function loadRoute(db, options = {}) {
  const overrides = {
    "@/lib/cron-auth": { ensureCronAuthorized: () => null },
    "@/lib/dating-open": { OPEN_CARD_AUTO_REQUEUE_LIMIT: 2 },
    "@/lib/dating-swipe": {
      sendDatingEmailToAddressDetailed: async (...args) => {
        db.sends.push(args);
        return options.sendResult ?? { ok: true, status: 200 };
      },
    },
    "@/lib/marketing-email": {
      appendMarketingEmailFooter: ({ body }) => body,
      fetchMarketingUnsubscribedUserIds: async () => new Set(options.unsubscribedUserIds ?? []),
    },
    "@/lib/supabase/server": { createAdminClient: () => db.admin },
    "next/server": { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { "content-type": "application/json" },
    }) } },
  };
  const cache = new Map();
  const load = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    const filename = path.join(root, `${name.slice(2)}.ts`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", output)(load, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  };
  const routeFile = path.join(root, "app/api/cron/dating-open-card-activity/route.ts");
  const output = ts.transpileModule(fs.readFileSync(routeFile, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output)(load, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}

function baseData(cardOverrides = {}, profileOverrides = {}, userOverrides = {}) {
  return {
    dating_cards: [{
      id: "card-1", owner_user_id: "user-1", status: "pending", auto_requeue_count: 2,
      queue_priority_at: isoAgo(10), inactivity_notice_sent_at: null,
      inactivity_notice_baseline_at: null, inactivity_deferred_at: null, ...cardOverrides,
    }],
    dating_card_applications: [{ id: "app-1", card_id: "card-1", status: "submitted" }],
    profiles: [{
      user_id: "user-1", nickname: "테스트", role: "user", is_banned: false,
      last_meaningful_activity_at: isoAgo(30), ...profileOverrides,
    }],
    admin_open_card_outreach_mail_logs: [],
    auth_users: [{
      id: "user-1", email: "user@example.com", email_confirmed_at: isoAgo(100),
      last_sign_in_at: isoAgo(30), ...userOverrides,
    }],
  };
}

async function run(initial, options) {
  const db = mockDatabase(initial, options);
  const route = loadRoute(db, options);
  const response = await route.GET(new Request("http://localhost/api/cron/dating-open-card-activity"));
  return { db, body: await response.json() };
}

test("a deployment before the SQL migration skips safely", async () => {
  const { body, db } = await run(baseData(), { missingActivitySchema: true });
  assert.equal(body.skipped, true);
  assert.equal(db.sends.length, 0);
});

test("recent activity keeps the card normal and sends no email", async () => {
  const { body, db } = await run(baseData({}, { last_meaningful_activity_at: isoAgo(1) }));
  assert.equal(body.emailed, 0);
  assert.equal(body.deferred, 0);
  assert.equal(db.sends.length, 0);
});

test("an inactive member is emailed before any queue change", async () => {
  const { body, db } = await run(baseData());
  assert.equal(body.emailed, 1);
  assert.equal(body.deferred, 0);
  assert.equal(db.sends.length, 1);
  assert.ok(db.tables.dating_cards[0].inactivity_notice_sent_at);
  assert.notEqual(db.tables.dating_cards[0].queue_priority_at, "9999-12-31T23:59:59.999Z");
});

test("only a full 72-hour no-activity grace period moves a pending card to the end", async () => {
  const noticeAt = isoAgo(4);
  const { body, db } = await run(baseData({
    inactivity_notice_sent_at: noticeAt,
    inactivity_notice_baseline_at: isoAgo(30),
  }));
  assert.equal(body.deferred, 1);
  assert.equal(db.tables.dating_cards[0].status, "pending");
  assert.equal(db.tables.dating_cards[0].queue_priority_at, "9999-12-31T23:59:59.999Z");
});

test("a public card is never pulled or reprioritized during its 24-hour window", async () => {
  const originalPriority = isoAgo(10);
  const { body, db } = await run(baseData({
    status: "public",
    queue_priority_at: originalPriority,
    inactivity_notice_sent_at: isoAgo(4),
    inactivity_notice_baseline_at: isoAgo(30),
  }));
  assert.equal(body.deferred, 1);
  assert.equal(db.tables.dating_cards[0].status, "public");
  assert.equal(db.tables.dating_cards[0].queue_priority_at, originalPriority);
  assert.ok(db.tables.dating_cards[0].inactivity_deferred_at);
});

test("new activity restores a deferred card automatically", async () => {
  const { body, db } = await run(baseData({
    inactivity_notice_sent_at: isoAgo(4),
    inactivity_notice_baseline_at: isoAgo(30),
    inactivity_deferred_at: isoAgo(1),
    queue_priority_at: "9999-12-31T23:59:59.999Z",
  }, { last_meaningful_activity_at: isoAgo(0.5) }));
  assert.equal(body.restored, 1);
  assert.equal(db.tables.dating_cards[0].inactivity_deferred_at, null);
  assert.notEqual(db.tables.dating_cards[0].queue_priority_at, "9999-12-31T23:59:59.999Z");
});

test("when no unanswered support remains, stale inactivity state is cleared", async () => {
  const data = baseData({
    inactivity_notice_sent_at: isoAgo(4),
    inactivity_notice_baseline_at: isoAgo(30),
    inactivity_deferred_at: isoAgo(1),
  });
  data.dating_card_applications[0].status = "canceled";
  const { body, db } = await run(data);
  assert.equal(body.restored, 1);
  assert.equal(db.tables.dating_cards[0].inactivity_deferred_at, null);
});

test("unsubscribed members are neither emailed nor demoted", async () => {
  const { body, db } = await run(baseData(), { unsubscribedUserIds: ["user-1"] });
  assert.equal(body.emailSkipped, 1);
  assert.equal(body.deferred, 0);
  assert.equal(db.sends.length, 0);
});

test("a successful mail log repairs state without sending a duplicate", async () => {
  const data = baseData();
  const baselineAt = data.profiles[0].last_meaningful_activity_at;
  data.admin_open_card_outreach_mail_logs.push({
    id: "log-1", campaign_key: "dating_registration_reminder", user_id: "user-1",
    success: true, sent_at: isoAgo(1),
    meta: { reason: "open_card_inactivity", card_id: "card-1", activity_baseline_at: baselineAt },
  });
  const { body, db } = await run(data);
  assert.equal(body.emailSkipped, 1);
  assert.equal(db.sends.length, 0);
  assert.equal(db.tables.dating_cards[0].inactivity_notice_sent_at, data.admin_open_card_outreach_mail_logs[0].sent_at);
});

test("a failed mail is retried at most once per 24 hours", async () => {
  const data = baseData();
  const baselineAt = data.profiles[0].last_meaningful_activity_at;
  data.admin_open_card_outreach_mail_logs.push({
    id: "log-1", campaign_key: "dating_registration_reminder", user_id: "user-1",
    success: false, sent_at: isoAgo(0.5),
    meta: { reason: "open_card_inactivity", card_id: "card-1", activity_baseline_at: baselineAt },
  });
  const { body, db } = await run(data);
  assert.equal(body.emailSkipped, 1);
  assert.equal(db.sends.length, 0);
  assert.equal(db.tables.dating_cards[0].inactivity_notice_sent_at, null);
});

test("application pagination finds a card after the first 500 rows", async () => {
  const data = baseData();
  data.dating_cards.push({ ...data.dating_cards[0], id: "card-2", owner_user_id: "user-2" });
  data.profiles.push({ ...data.profiles[0], user_id: "user-2" });
  data.auth_users.push({ ...data.auth_users[0], id: "user-2", email: "user2@example.com" });
  data.dating_card_applications = Array.from({ length: 500 }, (_, index) => ({
    id: `a-${String(index).padStart(4, "0")}`, card_id: "card-1", status: "submitted",
  }));
  data.dating_card_applications.push({ id: "z-last", card_id: "card-2", status: "submitted" });
  const { body } = await run(data);
  assert.equal(body.eligible, 2);
});

test("one cron run never sends more than the 30-email safety cap", async () => {
  const data = baseData();
  data.dating_cards = [];
  data.dating_card_applications = [];
  data.profiles = [];
  data.auth_users = [];
  for (let index = 0; index < 31; index += 1) {
    const suffix = String(index).padStart(2, "0");
    const cardId = `card-${suffix}`;
    const userId = `user-${suffix}`;
    data.dating_cards.push({
      id: cardId, owner_user_id: userId, status: "pending", auto_requeue_count: 2,
      queue_priority_at: isoAgo(10), inactivity_notice_sent_at: null,
      inactivity_notice_baseline_at: null, inactivity_deferred_at: null,
    });
    data.dating_card_applications.push({ id: `app-${suffix}`, card_id: cardId, status: "submitted" });
    data.profiles.push({
      user_id: userId, nickname: `회원${suffix}`, role: "user", is_banned: false,
      last_meaningful_activity_at: isoAgo(30),
    });
    data.auth_users.push({
      id: userId, email: `${userId}@example.com`, email_confirmed_at: isoAgo(100), last_sign_in_at: isoAgo(30),
    });
  }
  const { body, db } = await run(data);
  assert.equal(body.emailed, 30);
  assert.equal(body.emailSkipped, 1);
  assert.equal(db.sends.length, 30);
});
