/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness transpiles the real TS modules. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
// Load the real TypeScript modules, without adding a runtime/test dependency.
function createLoader(overrides = {}) {
  const cache = new Map();
  return function load(name) {
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
}
const load = createLoader();
const rules = load("@/lib/dating-1on1-recommendations");
const now = Date.parse("2026-08-31T03:00:00Z");
const day = 86400000;
const card = (id, overrides = {}) => ({
  id, user_id: `user-${id}`, sex: "female", age: 28, birth_year: 1999,
  region: "서울 강남구", created_at: "2026-01-01T00:00:00Z", ...overrides,
});
const source = card("source", { sex: "male", age: 30 });
const ids = (cards) => cards.map((candidate) => candidate.id);

function mockDatabase(tables, intercept) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = { table, fields: "*", filters: [], orders: [], from: 0, to: 999 };
      const builder = {
        select(fields) { query.fields = fields; return builder; },
        eq(key, value) { query.filters.push(["eq", key, value]); return builder; },
        is(key, value) { query.filters.push(["eq", key, value]); return builder; },
        neq(key, value) { query.filters.push(["neq", key, value]); return builder; },
        in(key, value) { query.filters.push(["in", key, value]); return builder; },
        gt(key, value) { query.filters.push(["gt", key, value]); return builder; },
        gte(key, value) { query.filters.push(["gte", key, value]); return builder; },
        lte(key, value) { query.filters.push(["lte", key, value]); return builder; },
        or(value) { query.filters.push(["or", value]); return builder; },
        order(key, options) { query.orders.push([key, options.ascending]); return builder; },
        range(from, to) { query.from = from; query.to = to; return builder; },
        limit(count) { query.to = count - 1; return builder; },
        maybeSingle() { query.single = true; return builder; },
        insert(values) { query.insert = Array.isArray(values) ? values : [values]; return builder; },
        update(values) { query.update = values; return builder; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            calls.push(structuredClone(query));
            const override = intercept?.(query, tables);
            if (override) return override;
            if (query.insert) {
              tables[table] ??= [];
              tables[table].push(...query.insert.map((row, i) => ({ id: `inserted-${tables[table].length + i}`, ...row })));
            }
            let rows = [...(tables[table] ?? [])];
            if (query.insert) rows = rows.slice(-query.insert.length);
            for (const [operation, key, value] of query.filters) {
              rows = rows.filter((row) => {
                if (operation === "eq") return row[key] === value;
                if (operation === "neq") return row[key] !== value;
                if (operation === "in") return value.includes(row[key]);
                if (operation === "gt") return row[key] != null && row[key] > value;
                if (operation === "gte") return row[key] != null && row[key] >= value;
                if (operation === "lte") return row[key] != null && row[key] <= value;
                if (operation === "or") {
                  const split = (text) => {
                    const parts = []; let depth = 0; let start = 0;
                    for (let i = 0; i < text.length; i++) {
                      if (text[i] === "(") depth++;
                      if (text[i] === ")") depth--;
                      if (text[i] === "," && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
                    }
                    return [...parts, text.slice(start)];
                  };
                  const matches = (expression) => {
                    if (expression.startsWith("and(")) return split(expression.slice(4, -1)).every(matches);
                    const [column, operator, ...rest] = expression.split(".");
                    assert.equal(operator, "eq");
                    return row[column] === rest.join(".");
                  };
                  return split(key).some(matches);
                }
                throw new Error(`Unhandled operator ${operation}`);
              });
            }
            rows.sort((a, b) => {
              for (const [key, ascending] of query.orders) {
                if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (ascending ? 1 : -1);
              }
              return 0;
            });
            rows = rows.slice(query.from, query.to + 1);
            if (query.update) rows.forEach((row) => Object.assign(row, query.update));
            if (query.fields !== "*") {
              rows = rows.map((row) => Object.fromEntries(query.fields.split(",").map((key) => [key.trim(), row[key.trim()]])));
            }
            return { data: query.single ? rows[0] ?? null : rows, error: null };
          }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function fixture(size = 15) {
  const year = new Date().getFullYear();
  const dbCard = (id, index, overrides = {}) => ({
    id, user_id: `user-${id}`, sex: "female", birth_year: year - 27,
    name: `테스트 ${id}`, height_cm: 170, job: "직장인", region: "서울 강남구",
    intro_text: "한글 소개", strengths_text: "성실함", preferred_partner_text: "서로 존중하는 사람",
    smoking: "non_smoker", workout_frequency: "3_4", status: "approved",
    created_at: "2026-01-01T00:00:00Z", recommendation_refresh_used_at: null,
    priority_boost_expires_at: null, phone: `+8210${String(index).padStart(8, "0")}`,
    photo_paths: [`user-${id}/photo.webp`], ...overrides,
  });
  const rows = [dbCard("source", 1, { sex: "male", birth_year: year - 29 }),
    ...Array.from({ length: size }, (_, i) => dbCard(`c${i}`, i + 2))];
  return {
    dating_1on1_cards: rows,
    profiles: rows.map((row) => ({ user_id: row.user_id, phone_e164: row.phone, is_banned: false })),
    dating_1on1_match_proposals: [],
  };
}

async function runApi(tables, { intercept, signedIn = true } = {}) {
  const db = mockDatabase(tables, intercept);
  const apiLoad = createLoader({
    "@/lib/supabase/server": { createAdminClient: () => db },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: signedIn ? { id: "user-source" } : null }) },
  });
  const { GET } = apiLoad("@/app/api/dating/1on1/recommendations/my/route");
  const response = await GET(new Request("http://localhost/api/dating/1on1/recommendations/my"));
  return { response, body: await response.json(), calls: db.calls };
}
async function runSelect(tables, { intercept, sourceId = "source", candidateId = "c0", admin = false, signedIn = true, allowedAdmin = true } = {}) {
  const db = mockDatabase(tables, intercept);
  const apiLoad = createLoader({
    "@/lib/supabase/server": { createAdminClient: () => db },
    "@/lib/supabase/request": { getRequestAuthContext: async () => ({ user: signedIn ? { id: "user-source" } : null }) },
    "@/lib/admin": { isAllowedAdminUser: () => allowedAdmin },
  });
  const { POST } = apiLoad(`@/app/api/dating/1on1/matches/${admin ? "admin" : "auto"}/route`);
  const response = await POST(new Request("http://localhost/api/dating/1on1/matches/auto", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_card_id: sourceId, ...(admin ? { candidate_card_ids: [candidateId] } : { candidate_card_id: candidateId }) }),
  }));
  return { response, body: await response.json(), calls: db.calls };
}
function allCandidates(body) {
  return body.items.flatMap((item) => [...item.recommendations, ...item.admin_recommendations]);
}
function pair(overrides = {}) {
  return {
    id: "pair", source_card_id: "source", candidate_card_id: "c0",
    source_user_id: "user-source", candidate_user_id: "user-c0", state: "source_selected",
    created_at: new Date().toISOString(), source_selected_at: new Date().toISOString(),
    candidate_responded_at: null, updated_at: new Date().toISOString(), ...overrides,
  };
}

test("extra candidates never overlap main candidates, even in a small pool", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => card(String(i)));
  assert.deepEqual(rules.takeRecommendations(candidates, 3, new Set(ids(candidates))), []);
  assert.deepEqual(ids(rules.takeRecommendations([...candidates, card("extra")], 3, new Set(ids(candidates)))), ["extra"]);
});
test("actual age quota is met despite four recent nearby out-of-age candidates", () => {
  const recent = Array.from({ length: 4 }, (_, i) => card(`recent-${i}`, { age: 45, created_at: new Date(now).toISOString() }));
  const ageMatched = Array.from({ length: 6 }, (_, i) => card(`age-${i}`, { age: 26, region: "부산 해운대구" }));
  const others = Array.from({ length: 8 }, (_, i) => card(`other-${i}`, { age: 45 }));
  const result = rules.takeBalancedRecommendations(source, [...recent, ...others, ...ageMatched], 10, new Set(), now);
  assert.equal(result.length, 10);
  assert.equal(result.filter((candidate) => rules.isCandidateInSourceAgeRange(source, candidate)).length, 6);
});
test("recent candidates count toward both quotas when applicable", () => {
  const recent = Array.from({ length: 4 }, (_, i) => card(`recent-${i}`, { last_active_at: new Date(now).toISOString() }));
  const candidates = [...recent, ...Array.from({ length: 20 }, (_, i) => card(String(i)))];
  const sorted = rules.sortCandidatesForSource(source, candidates, "day", now);
  const result = rules.takeBalancedRecommendations(source, sorted, 10, new Set(), now);
  assert.equal(result.filter((candidate) => candidate.last_active_at).length, 4);
  assert.equal(result.length, 10);
});
test("daily variety does not move remote candidates ahead of equally suitable local candidates", () => {
  const candidates = [card("local"), card("remote", { region: "부산 해운대구" })];
  for (let i = 0; i < 30; i += 1) {
    const sorted = rules.sortCandidatesForSource(source, candidates, String(i), now);
    assert.equal(sorted[0].id, "local");
    assert.equal(rules.takeBalancedRecommendations(source, sorted, 10, new Set(), now)[0].id, "local");
  }
});
test("recent real activity outranks unknown activity within the same geography and age tier", () => {
  const sorted = rules.sortCandidatesForSource(source, [card("unknown"), card("active", { last_active_at: new Date(now - day).toISOString() })], "day", now);
  assert.equal(sorted[0].id, "active");
});
test("Plus priority survives daily seed changes within an equivalent relevance tier", () => {
  for (let i = 0; i < 20; i += 1) {
    const candidates = [card("free"), card("plus", { plus_expires_at: new Date(now + day).toISOString() })];
    assert.equal(rules.sortCandidatesForSource(source, candidates, String(i), now)[0].id, "plus");
  }
});
test("unknown ages/regions and invalid dates remain eligible without throwing", () => {
  const candidates = [card("unknown", { age: null, region: "", created_at: "invalid" })];
  assert.equal(rules.takeBalancedRecommendations(source, rules.sortCandidatesForSource(source, candidates, "day", now), 10, new Set(), now).length, 1);
});
test("main soft exclusions are used only when alternatives are insufficient", () => {
  const candidates = Array.from({ length: 12 }, (_, i) => card(String(i)));
  const exclude = new Set(["0", "1"]);
  assert.equal(rules.takeBalancedRecommendations(source, candidates, 10, exclude, now).some((candidate) => exclude.has(candidate.id)), false);
  assert.equal(rules.takeBalancedRecommendations(source, candidates.slice(0, 3), 10, exclude, now).length, 3);
});
test("refresh prioritizes alternatives and expires at exactly 24 hours", () => {
  assert.equal(rules.getActiveRecommendationRefresh(new Date(now - day).toISOString(), now), null);
  assert.equal(rules.getActiveRecommendationRefresh("invalid", now), null);
  assert.equal(rules.getActiveRecommendationRefresh(new Date(now + day).toISOString(), now), null);
  assert.ok(rules.getActiveRecommendationRefresh(new Date(now - day + 1).toISOString(), now));
  assert.equal(rules.sortRefreshCandidatesForSource(source, [card("old"), card("new")], "refresh", new Set(["old"]), now)[0].id, "new");
});
test("selection has no duplicate IDs, respects the limit and retains sorted order across varied pools", () => {
  for (let size = 0; size <= 60; size += 1) {
    const candidates = Array.from({ length: size }, (_, i) => card(String(i), { age: 19 + i % 32, region: i % 2 ? "서울 강남구" : "부산 해운대구" }));
    const sorted = rules.sortCandidatesForSource(source, candidates, "day", now);
    const result = rules.takeBalancedRecommendations(source, sorted, 10, new Set(), now);
    assert.equal(result.length, Math.min(size, 10));
    assert.equal(new Set(ids(result)).size, result.length);
    assert.deepEqual(ids(result), ids(sorted.filter((candidate) => ids(result).includes(candidate.id))));
    const extras = rules.takeRecommendations(sorted, 3, new Set(ids(result)));
    assert.equal(extras.some((candidate) => ids(result).includes(candidate.id)), false);
  }
});

test("API rejects unsigned requests without a database query", async () => {
  const result = await runApi(fixture(), { signedIn: false });
  assert.equal(result.response.status, 401);
  assert.equal(result.calls.length, 0);
});
test("API returns immediately for users with no application", async () => {
  const tables = fixture();
  tables.dating_1on1_cards.shift();
  const result = await runApi(tables);
  assert.deepEqual(result.body, { items: [] });
  assert.equal(result.calls.length, 1);
  assert.ok(result.calls[0].filters.some(([op, key, value]) => op === "eq" && key === "user_id" && value === "user-source"));
});
test("API fetches only opposite-sex summaries and hydrates at most 13 unique cards", async () => {
  const tables = fixture(80);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[0], id: "same-sex", user_id: "other-male" });
  const result = await runApi(tables);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.items[0].recommendations.length, 10);
  assert.equal(result.body.items[0].admin_recommendations.length, 3);
  const candidates = allCandidates(result.body);
  assert.equal(new Set(ids(candidates)).size, 13);
  assert.ok(candidates.every((candidate) => candidate.sex === "female"));
  const scans = result.calls.filter((call) => call.table === "dating_1on1_cards");
  assert.ok(scans.length >= 3);
  assert.ok(scans[1].filters.some(([op, key, value]) => op === "in" && key === "sex" && value.join() === "female"));
  for (const scan of scans.slice(0, 2)) {
    assert.equal(scan.fields.includes("photo_paths"), false);
    assert.equal(scan.fields.includes("intro_text"), false);
  }
  const details = scans.filter((query) => query.fields.includes("photo_paths"));
  assert.equal(details.length, 1);
  assert.equal(details[0].filters.find(([op, key]) => op === "in" && key === "id")[2].length, 13);
  const identityScans = scans.filter((query) => query.fields === "id,user_id,phone,created_at");
  assert.ok(identityScans.every((query) => query.filters.some(([op, key]) => op === "in" && ["user_id", "phone"].includes(key))));
  for (const candidate of candidates) {
    assert.equal(candidate.intro_text, "한글 소개");
    assert.equal(candidate.photo_signed_urls.length, 1);
    for (const internal of ["phone", "phone_e164", "last_active_at", "priority_boost_expires_at", "plus_expires_at", "photo_paths"]) {
      assert.equal(Object.hasOwn(candidate, internal), false);
    }
  }
});
test("female source sees only male candidates", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards[0].sex = "female";
  tables.dating_1on1_cards[1].sex = "male";
  const result = await runApi(tables);
  assert.deepEqual(ids(allCandidates(result.body)), ["c0"]);
});
test("banned, withdrawn and rejected cards are excluded", async () => {
  const tables = fixture(4);
  tables.profiles.find((row) => row.user_id === "user-c0").is_banned = true;
  tables.profiles = tables.profiles.filter((row) => row.user_id !== "user-c1");
  tables.dating_1on1_cards.find((row) => row.id === "c2").status = "rejected";
  const result = await runApi(tables);
  assert.deepEqual(ids(allCandidates(result.body)), ["c3"]);
});
test("banned source cannot request recommendations", async () => {
  const tables = fixture();
  tables.profiles[0].is_banned = true;
  assert.equal((await runApi(tables)).response.status, 403);
});
test("identity duplicates and own verified phone are excluded", async () => {
  const tables = fixture(4);
  tables.profiles[1].phone_e164 = tables.profiles[0].phone_e164;
  tables.profiles[2].phone_e164 = "+821012345678";
  tables.profiles[3].phone_e164 = "01012345678";
  tables.dating_1on1_cards[3].created_at = "2026-02-01T00:00:00Z";
  const result = await runApi(tables);
  assert.deepEqual(new Set(ids(allCandidates(result.body))), new Set(["c2", "c3"]));
});
for (const reverse of [false, true]) {
  test(`active and permanent rejection exclusions work ${reverse ? "in reverse" : "directly"}`, async () => {
    const tables = fixture(3);
    const makePair = (candidate, state) => pair({
      id: `pair-${candidate}`, state,
      source_card_id: reverse ? candidate : "source", candidate_card_id: reverse ? "source" : candidate,
      source_user_id: reverse ? `user-${candidate}` : "user-source", candidate_user_id: reverse ? "user-source" : `user-${candidate}`,
    });
    tables.dating_1on1_match_proposals = [makePair("c0", "mutual_accepted"), makePair("c1", "candidate_rejected")];
    // Permanent rejection is user-level even after the old card is replaced.
    tables.dating_1on1_cards.find((row) => row.id === "c1").id = "c1-new";
    assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c2"]);
  });
  test(`user and admin blocks work ${reverse ? "in reverse" : "directly"}`, async () => {
    const tables = fixture(3);
    tables.dating_user_blocks = [{ blocker_user_id: reverse ? "user-c0" : "user-source", blocked_user_id: reverse ? "user-source" : "user-c0" }];
    tables.dating_1on1_admin_user_blocks = [{ user_a_id: reverse ? "user-c1" : "user-source", user_b_id: reverse ? "user-source" : "user-c1" }];
    assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c2"]);
  });
  test(`phone and unified contact blocks work ${reverse ? "in reverse" : "directly"}`, async () => {
    const tables = fixture(3);
    const phoneLib = load("@/lib/dating-1on1-phone-blocks");
    const contactLib = load("@/lib/dating-contact-blocks");
    tables.dating_1on1_phone_blocks = [{ user_id: reverse ? "user-c0" : "user-source", phone_hash: phoneLib.hashOneOnOneBlockedPhone(tables.profiles[reverse ? 0 : 1].phone_e164) }];
    tables.dating_contact_blocks = [{ user_id: reverse ? "user-c1" : "user-source", block_type: "phone", value_hash: contactLib.hashDatingContactBlockValue("phone", tables.profiles[reverse ? 0 : 2].phone_e164) }];
    assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c2"]);
  });
}
test("expired pending pairs can refill a small main pool but never create duplicate extras", async () => {
  const tables = fixture(1);
  tables.dating_1on1_match_proposals = [pair({ source_selected_at: new Date(Date.now() - 3 * day).toISOString() })];
  const result = await runApi(tables);
  assert.deepEqual(ids(result.body.items[0].recommendations), ["c0"]);
  assert.deepEqual(result.body.items[0].admin_recommendations, []);
});
test("safe schema fallback retains opposite-sex filtering and avoids detail fields", async () => {
  const result = await runApi(fixture(2), { intercept: (query) => query.fields.includes("priority_boost_expires_at")
    ? { data: null, error: { code: "42703", message: "column priority_boost_expires_at does not exist" } } : null });
  assert.equal(result.response.status, 200);
  assert.equal(allCandidates(result.body).length, 2);
  const candidateScans = result.calls.filter((query) => query.table === "dating_1on1_cards" && !query.fields.includes("photo_paths") && query.filters.some(([op, key]) => op === "neq" && key === "user_id"));
  assert.equal(candidateScans.length, 2);
  assert.ok(candidateScans.every((query) => query.filters.some(([op, key]) => op === "in" && key === "sex")));
});
test("summary pagination does not silently cap the eligible pool at 500 or 1000", async () => {
  const result = await runApi(fixture(1005));
  assert.equal(result.body.items[0].candidate_pool_count, 1005);
  const candidateScans = result.calls.filter((query) => query.table === "dating_1on1_cards" && query.filters.some(([op]) => op === "neq"));
  assert.deepEqual(candidateScans.map((query) => query.from), [0, 500, 1000]);
  assert.equal(allCandidates(result.body).length, 13);
});
test("optional activity failure preserves candidates, but ban/context/detail failures do not disclose them", async () => {
  const failure = { data: null, error: { code: "XX000", message: "backend unavailable" } };
  const activityFailure = await runApi(fixture(2), { intercept: (query) => query.filters.some(([op]) => op === "gte") ? failure : null });
  assert.equal(activityFailure.response.status, 200);
  assert.equal(allCandidates(activityFailure.body).length, 2);
  for (const table of ["profiles", "dating_user_blocks"]) {
    const result = await runApi(fixture(2), { intercept: (query) => query.table === table ? failure : null });
    assert.equal(result.response.status, 500);
    assert.equal(Object.hasOwn(result.body, "items"), false);
  }
  const detailFailure = await runApi(fixture(2), { intercept: (query) => query.fields.includes("photo_paths") ? failure : null });
  assert.equal(detailFailure.response.status, 500);
});
test("cards changed to rejected or another sex during hydration are omitted", async () => {
  const result = await runApi(fixture(3), { intercept: (query, tables) => {
    if (query.fields.includes("photo_paths")) {
      tables.dating_1on1_cards.find((row) => row.id === "c0").status = "rejected";
      tables.dating_1on1_cards.find((row) => row.id === "c1").sex = "male";
    }
  } });
  assert.deepEqual(ids(allCandidates(result.body)), ["c2"]);
});
test("activity credits only the participant who acted, not the passive recipient", async () => {
  const tables = fixture(2);
  tables.dating_1on1_match_proposals = [pair({ source_user_id: "user-c0", candidate_user_id: "user-c1", source_selected_at: new Date(now - day).toISOString(), candidate_responded_at: null })];
  const activity = await load("@/lib/dating-1on1-recommendation-data").fetchRecommendationActivity(mockDatabase(tables), ["user-c0", "user-c1"], now);
  assert.equal(activity.has("user-c0"), true);
  assert.equal(activity.has("user-c1"), false);
});
test("free/Plus refresh limits and legacy timestamps remain compatible", async () => {
  for (const plus of [false, true]) {
    const tables = fixture(1);
    const refreshedAt = new Date(Date.now() - 10000).toISOString();
    tables.dating_1on1_cards[0].recommendation_refresh_used_at = refreshedAt;
    tables.dating_1on1_recommendation_refresh_events = [{ card_id: "source", refreshed_at: refreshedAt }];
    if (plus) tables.dating_1on1_plus_subscriptions = [{ user_id: "user-source", expires_at: new Date(Date.now() + day).toISOString() }];
    const group = (await runApi(tables)).body.items[0];
    assert.equal(group.refresh_limit, plus ? 2 : 1);
    assert.equal(group.refresh_used_count, 1);
    assert.equal(group.refresh_remaining, plus ? 1 : 0);
    assert.equal(group.can_refresh, plus);
  }
});

test("activity lookup skips already-found busy members without losing quieter members", async () => {
  const tables = fixture(2);
  tables.dating_1on1_match_proposals = Array.from({ length: 2000 }, (_, index) => pair({
    id: `busy-${index}`, source_user_id: "user-c0", source_selected_at: new Date(now - 10000).toISOString(),
  }));
  tables.dating_1on1_match_proposals.push(pair({ id: "quiet", source_user_id: "user-c1", source_selected_at: new Date(now - day).toISOString() }));
  const db = mockDatabase(tables);
  const activity = await load("@/lib/dating-1on1-recommendation-data").fetchRecommendationActivity(db, ["user-c0", "user-c1"], now);
  assert.equal(activity.size, 2);
  assert.equal(db.calls.filter((query) => query.fields.includes("source_selected_at")).length, 2);
});
test("UUID lookup batches stay below the HTTP header limit", async () => {
  const result = await runApi(fixture(605));
  for (const query of result.calls) {
    for (const [operation, key, value] of query.filters) {
      if (operation === "in" && key === "user_id") assert.ok(value.length <= 200);
    }
  }
});

test("phone/contact blocks beyond the first 1000 rows are still enforced", async () => {
  const phoneRows = Array.from({ length: 1105 }, (_, i) => ({ id: String(i).padStart(5, "0"), user_id: "one-user", phone_hash: `hash-${i}` }));
  const contactRows = phoneRows.map((row) => ({ id: row.id, user_id: row.user_id, block_type: "phone", value_hash: row.phone_hash }));
  const db = mockDatabase({ dating_1on1_phone_blocks: phoneRows, dating_contact_blocks: contactRows });
  const phoneMap = await load("@/lib/dating-1on1-phone-blocks").getOneOnOnePhoneBlockMapForUsers(db, ["one-user"]);
  const contactMap = await load("@/lib/dating-contact-blocks").getDatingContactBlockMapForUsers(db, ["one-user"]);
  assert.equal(phoneMap.get("one-user").size, 1105);
  assert.equal(contactMap.get("one-user:phone").size, 1105);
});

for (const reverse of [false, true]) {
  for (const state of ["proposed", "source_selected", "candidate_accepted", "mutual_accepted"]) {
    test(`recreated source AND candidate cannot bypass ${state} (${reverse ? "reverse" : "direct"})`, async () => {
      const tables = fixture(2);
      for (const id of ["source", "c0"]) {
        const current = tables.dating_1on1_cards.find((row) => row.id === id);
        tables.dating_1on1_cards.push({ ...current, id: `old-${id}`, status: "rejected" });
      }
      tables.dating_1on1_match_proposals = [pair({ state,
        source_card_id: reverse ? "old-c0" : "old-source", candidate_card_id: reverse ? "old-source" : "old-c0",
        source_user_id: reverse ? "user-c0" : "user-source", candidate_user_id: reverse ? "user-source" : "user-c0",
      })];
      assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c1"]);
      for (const admin of [false, true]) {
        const selected = await runSelect(tables, { admin });
        assert.equal(selected.response.status, 409);
        assert.equal(selected.calls.some((query) => query.insert || query.update), false);
      }
    });
  }
}

test("gender changed after an old card: no obsolete recommendation and neither endpoint accepts it", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[1], id: "new-male", sex: "male", created_at: new Date().toISOString() });
  assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c1"]);
  for (const admin of [false, true]) {
    const result = await runSelect(tables, { admin });
    assert.equal(result.response.status, 409);
    assert.equal(result.calls.some((query) => query.insert), false);
  }
});

test("source gender follows newest card, and stale source selection reloads instead of matching", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[0], id: "new-source", sex: "female", created_at: new Date().toISOString() });
  const body = (await runApi(tables)).body;
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].source_card_id, "new-source");
  assert.deepEqual(allCandidates(body), []);
  const result = await runSelect(tables);
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, "STALE_SOURCE_IDENTITY");
});

test("cross-sex identity duplicates are detected across accounts and phone formats", async () => {
  const tables = fixture(2);
  const newer = { ...tables.dating_1on1_cards[1], id: "new-identity", user_id: "other-account", sex: "male", created_at: new Date().toISOString() };
  newer.phone = "01012345678";
  tables.profiles[1].phone_e164 = "+821012345678";
  tables.dating_1on1_cards[1].phone = "+821012345678";
  tables.dating_1on1_cards.push(newer);
  tables.profiles.push({ user_id: newer.user_id, phone_e164: newer.phone, is_banned: false });
  assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c1"]);
  assert.equal((await runSelect(tables)).response.status, 409);
});

test("same-timestamp latest identity uses the same deterministic ID tie-break for display and selection", async () => {
  const tables = fixture(2);
  tables.dating_1on1_cards.push({ ...tables.dating_1on1_cards[1], id: "z-new" });
  assert.deepEqual(new Set(ids(allCandidates((await runApi(tables)).body))), new Set(["c1", "z-new"]));
  assert.equal((await runSelect(tables)).response.status, 409);
  assert.equal((await runSelect(tables, { candidateId: "z-new" })).response.status, 200);
});

test("all historical rows are checked: an expired row cannot conceal a live duplicate after 1000 rows", async () => {
  const tables = fixture(1);
  tables.dating_1on1_match_proposals = Array.from({ length: 1001 }, (_, i) => pair({ id: `expired-${i}`, source_selected_at: new Date(Date.now() - 3 * day).toISOString() }));
  tables.dating_1on1_match_proposals.push(pair({ id: "live", state: "mutual_accepted", candidate_card_id: "old-c0", created_at: "2025-01-01T00:00:00Z" }));
  assert.deepEqual(allCandidates((await runApi(tables)).body), []);
  const result = await runSelect(tables);
  assert.equal(result.response.status, 409);
  assert.equal(result.calls.some((query) => query.update || query.insert), false);
});

test("expired pairs allow retry, without sacrificing small-pool candidate re-exposure", async () => {
  const tables = fixture(1);
  tables.dating_1on1_match_proposals = [pair({ source_selected_at: new Date(Date.now() - 3 * day).toISOString() })];
  assert.deepEqual(ids(allCandidates((await runApi(tables)).body)), ["c0"]);
  const result = await runSelect(tables);
  assert.equal(result.response.status, 200);
  assert.equal(tables.dating_1on1_match_proposals[0].state, "admin_canceled");
  assert.equal(tables.dating_1on1_match_proposals[1].state, "source_selected");
});

test("expired-pair cleanup aborts when the pair changed concurrently", async () => {
  const tables = fixture(1);
  tables.dating_1on1_match_proposals = [pair({ source_selected_at: new Date(Date.now() - 3 * day).toISOString() })];
  const result = await runSelect(tables, { intercept: (query) => query.update ? { data: null, error: null } : null });
  assert.equal(result.response.status, 409);
  assert.equal(result.body.code, "CANDIDATE_PAIR_CHANGED");
  assert.equal(result.calls.some((query) => query.insert), false);
});

test("normal selection succeeds, but replay cannot insert a second user-pair", async () => {
  for (const admin of [false, true]) {
    const tables = fixture(1);
    assert.equal((await runSelect(tables, { admin })).response.status, 200);
    assert.equal((await runSelect(tables, { admin })).response.status, 409);
    assert.equal(tables.dating_1on1_match_proposals.length, 1);
  }
});

test("selection still rejects banned, withdrawn, blocked and permanently rejected members", async () => {
  for (const condition of ["banned", "withdrawn", "blocked", "rejected", "reverse-rejected"]) {
    const tables = fixture(1);
    if (condition === "banned") tables.profiles[1].is_banned = true;
    if (condition === "withdrawn") tables.profiles.pop();
    if (condition === "blocked") tables.dating_user_blocks = [{ id: "block", blocker_user_id: "user-c0", blocked_user_id: "user-source" }];
    if (condition === "rejected") tables.dating_1on1_match_proposals = [pair({ state: "candidate_rejected", candidate_card_id: "old-c0" })];
    if (condition === "reverse-rejected") tables.dating_1on1_match_proposals = [pair({ state: "source_declined", source_user_id: "user-c0", candidate_user_id: "user-source" })];
    for (const admin of [false, true]) {
      const result = await runSelect(tables, { admin });
      assert.equal(result.response.status, 409, condition);
      assert.equal(result.calls.some((query) => query.insert), false);
    }
  }
});

test("new identity/history safety queries fail closed", async () => {
  const failure = { data: null, error: { code: "XX000", message: "backend unavailable" } };
  for (const field of ["id,user_id,phone,created_at", "id,source_card_id,candidate_card_id,source_user_id,candidate_user_id,state,source_selected_at,updated_at,created_at"]) {
    const intercept = (query) => query.fields === field ? failure : null;
    assert.equal((await runApi(fixture(1), { intercept })).response.status, 500);
    for (const admin of [false, true]) {
      const result = await runSelect(fixture(1), { intercept, admin });
      assert.equal(result.response.status, 500);
      assert.equal(result.calls.some((query) => query.insert), false);
    }
  }
});

test("selection preserves authentication, admin-role and source ownership boundaries", async () => {
  assert.equal((await runSelect(fixture(), { signedIn: false })).response.status, 401);
  assert.equal((await runSelect(fixture(), { admin: true, allowedAdmin: false })).response.status, 403);
  assert.equal((await runSelect(fixture(), { sourceId: "c1" })).response.status, 403);
});

test("large pools validate only the displayed shortlist, without loading all identity rows", async () => {
  const result = await runApi(fixture(1005));
  const ownerLookups = result.calls.filter((query) => query.fields === "id,user_id,phone,created_at" &&
    query.filters.some(([op, key]) => op === "in" && key === "user_id"));
  assert.equal(ownerLookups.length, 1);
  assert.equal(ownerLookups[0].filters.find(([op, key]) => op === "in" && key === "user_id")[2].length, 14);
  assert.equal(allCandidates(result.body).length, 13);
});

test("stale shortlist members are refilled, and an entirely stale pool terminates without leaking photos", async () => {
  for (const staleCount of [20, 30]) {
    const tables = fixture(30);
    for (const row of tables.dating_1on1_cards.slice(1, staleCount + 1)) {
      tables.dating_1on1_cards.push({ ...row, id: `new-${row.id}`, sex: "male", created_at: new Date().toISOString() });
    }
    const result = await runApi(tables);
    assert.equal(result.response.status, 200);
    const candidates = allCandidates(result.body);
    assert.equal(candidates.length, 30 - staleCount);
    assert.equal(new Set(ids(candidates)).size, candidates.length);
    const photoScans = result.calls.filter((query) => query.fields.includes("photo_paths"));
    assert.equal(photoScans.length, staleCount === 30 ? 0 : 1);
    assert.ok(result.calls.length < 100);
  }
});
