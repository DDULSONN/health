/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS harness loads the real TypeScript queue module. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function loadQueue(limit = 3) {
  const overrides = {
    "@/lib/dating-open": {
      OPEN_CARD_EXPIRE_HOURS: 24,
      getOpenCardEffectiveLimitBySex: async () => limit,
    },
    "@/lib/supabase/server": { createAdminClient: () => { throw new Error("not used"); } },
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
  return load("@/lib/dating-cards-queue");
}

function mockDatabase(initial = {}, options = {}) {
  const tables = structuredClone(initial);
  const calls = [];
  const from = (table) => {
    const query = { table, filters: [], orders: [], limit: Infinity, fields: "*", head: false, count: false };
    const execute = async () => {
      // Yield once so simultaneous queue syncs contend on the same lock row.
      await Promise.resolve();
      calls.push(structuredClone(query));
      if (options.failTable === table) {
        return { data: null, error: { code: "XX000", message: "simulated database failure" }, count: null };
      }
      tables[table] ??= [];
      const matches = (row) => query.filters.every(([operator, key, value]) => {
        if (operator === "eq") return row[key] === value;
        if (operator === "lt") return row[key] != null && row[key] < value;
        if (operator === "lte") return row[key] != null && row[key] <= value;
        if (operator === "gt") return row[key] != null && row[key] > value;
        if (operator === "is") return value === null ? row[key] == null : row[key] === value;
        if (operator === "in") return value.includes(row[key]);
        throw new Error(`unsupported filter ${operator}`);
      });
      if (query.insert) {
        const values = Array.isArray(query.insert) ? query.insert : [query.insert];
        for (const value of values) {
          if (table === "site_settings" && tables[table].some((row) => row.key === value.key)) {
            return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
          }
          tables[table].push(structuredClone(value));
        }
        return { data: values, error: null, count: values.length };
      }
      let rows = tables[table].filter(matches);
      for (const [key, ascending] of [...query.orders].reverse()) {
        rows.sort((a, b) => (a[key] === b[key] ? 0 : a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1));
      }
      rows = rows.slice(0, query.limit);
      if (query.update) {
        for (const row of rows) Object.assign(row, structuredClone(query.update));
      }
      const count = rows.length;
      const projected = query.fields === "*" ? rows : rows.map((row) => Object.fromEntries(
        query.fields.split(",").map((field) => field.trim()).filter(Boolean).map((field) => [field, row[field]]),
      ));
      return { data: query.head ? null : structuredClone(projected), error: null, count: query.count ? count : null };
    };
    const builder = {
      select(fields, options = {}) { query.fields = fields; query.head = options.head === true; query.count = options.count === "exact"; return builder; },
      eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
      lt(key, value) { query.filters.push(["lt", key, value]); return builder; },
      lte(key, value) { query.filters.push(["lte", key, value]); return builder; },
      gt(key, value) { query.filters.push(["gt", key, value]); return builder; },
      is(key, value) { query.filters.push(["is", key, value]); return builder; },
      in(key, value) { query.filters.push(["in", key, value]); return builder; },
      order(key, options = {}) { query.orders.push([key, options.ascending !== false]); return builder; },
      limit(value) { query.limit = value; return builder; },
      update(value) { query.update = value; return builder; },
      insert(value) { query.insert = value; return builder; },
      async maybeSingle() { const result = await execute(); return { ...result, data: result.data?.[0] ?? null }; },
      then(resolve, reject) { return execute().then(resolve, reject); },
    };
    return builder;
  };
  return { from, tables, calls };
}

const future = "2099-01-01T00:00:00.000Z";
const past = "2020-01-01T00:00:00.000Z";
const lock = () => ({ key: "open_card_queue_sync_lock", value_json: { initialized: true }, updated_at: past });
const card = (id, overrides = {}) => ({
  id, sex: "male", status: "pending", created_at: `2026-01-${String(Number(id.replace(/\D/g, "")) || 1).padStart(2, "0")}T00:00:00.000Z`,
  queue_priority_at: past, published_at: null, expires_at: null, auto_requeue_count: 0, ...overrides,
});

test("a public overflow never cuts short an unexpired card", async () => {
  const db = mockDatabase({
    site_settings: [lock()],
    dating_cards: [card("1", { status: "public", expires_at: future }), card("2", { status: "public", expires_at: future }),
      card("3", { status: "public", expires_at: future }), card("4", { status: "public", expires_at: future })],
  });
  const result = await loadQueue(3).syncOpenCardQueue(db);
  assert.equal(result.skipped, false);
  assert.equal(db.tables.dating_cards.every((row) => row.status === "public"), true);
  assert.deepEqual(result.trimmed, { male: [], female: [] });
  assert.equal(db.calls.some((call) => call.update?.status === "pending" && call.filters.some(([, key]) => key === "expires_at")), false);
});

test("simultaneous syncs share one database lease and never over-promote", async () => {
  const db = mockDatabase({
    site_settings: [lock()],
    dating_cards: [card("1", { status: "public", expires_at: future }), card("2"), card("3")],
  });
  const results = await Promise.all([loadQueue(2).syncOpenCardQueue(db), loadQueue(2).syncOpenCardQueue(db)]);
  assert.equal(results.filter((result) => result.skipped).length, 1);
  assert.equal(db.tables.dating_cards.filter((row) => row.status === "public").length, 2);
});

test("the lock row is initialized safely and the next concurrent caller skips", async () => {
  const db = mockDatabase({ dating_cards: [card("1")] });
  const results = await Promise.all([loadQueue(1).syncOpenCardQueue(db), loadQueue(1).syncOpenCardQueue(db)]);
  assert.equal(db.tables.site_settings.length, 1);
  assert.equal(results.filter((result) => result.skipped).length, 1);
  assert.equal(db.tables.dating_cards[0].status, "public");
});

test("newly published cards receive a complete 24-hour window", async () => {
  const db = mockDatabase({ site_settings: [lock()], dating_cards: [card("1")] });
  const before = Date.now();
  await loadQueue(1).syncOpenCardQueue(db);
  const published = db.tables.dating_cards[0];
  assert.equal(published.status, "public");
  assert.ok(Date.parse(published.published_at) >= before);
  assert.equal(Date.parse(published.expires_at) - Date.parse(published.published_at), 24 * 60 * 60 * 1000);
});

test("an inactive deferred card keeps the final queue priority after its public window ends", async () => {
  const db = mockDatabase({
    site_settings: [lock()],
    dating_cards: [card("1", {
      status: "public",
      expires_at: past,
      published_at: past,
      auto_requeue_count: 2,
      inactivity_deferred_at: past,
    })],
  });
  await loadQueue(0).syncOpenCardQueue(db);
  const deferred = db.tables.dating_cards[0];
  assert.equal(deferred.status, "pending");
  assert.equal(deferred.queue_priority_at, "9999-12-31T23:59:59.999Z");
  assert.equal(deferred.auto_requeue_count, 3);
});

test("a fresh lease fails closed without mutating cards and expires automatically", async () => {
  const freshDb = mockDatabase({ site_settings: [{ ...lock(), updated_at: new Date().toISOString() }], dating_cards: [card("1")] });
  assert.equal((await loadQueue(1).syncOpenCardQueue(freshDb)).skipped, true);
  assert.equal(freshDb.tables.dating_cards[0].status, "pending");

  freshDb.tables.site_settings[0].updated_at = new Date(Date.now() - 121000).toISOString();
  assert.equal((await loadQueue(1).syncOpenCardQueue(freshDb)).skipped, false);
  assert.equal(freshDb.tables.dating_cards[0].status, "public");
});

test("database lock failures fail closed without touching queue data", async () => {
  const db = mockDatabase({ site_settings: [lock()], dating_cards: [card("1")] }, { failTable: "site_settings" });
  await assert.rejects(() => loadQueue(1).syncOpenCardQueue(db),
    (error) => error?.code === "XX000" && error?.message === "simulated database failure");
  assert.equal(db.tables.dating_cards[0].status, "pending");
  assert.equal(db.calls.some((call) => call.table === "dating_cards"), false);
});

test("varied limits and concurrent callers never demote valid public cards or exceed the safe ceiling", async () => {
  for (let limit = 0; limit <= 8; limit += 1) {
    for (let initialPublic = 0; initialPublic <= 10; initialPublic += 2) {
      const publicCards = Array.from({ length: initialPublic }, (_, index) =>
        card(`p${index + 1}`, { status: "public", expires_at: future, published_at: past }));
      const pendingCards = Array.from({ length: 12 }, (_, index) => card(`q${index + 20}`));
      const db = mockDatabase({ site_settings: [lock()], dating_cards: [...publicCards, ...pendingCards] });
      const results = await Promise.all(Array.from({ length: 5 }, () => loadQueue(limit).syncOpenCardQueue(db)));
      const finalPublic = db.tables.dating_cards.filter((row) => row.status === "public");
      assert.equal(results.filter((result) => !result.skipped).length, 1);
      assert.ok(publicCards.every((original) => finalPublic.some((row) => row.id === original.id)));
      assert.equal(finalPublic.length, Math.max(initialPublic, limit));
      for (const promoted of finalPublic.filter((row) => row.published_at !== past)) {
        assert.equal(Date.parse(promoted.expires_at) - Date.parse(promoted.published_at), 24 * 60 * 60 * 1000);
      }
    }
  }
});
